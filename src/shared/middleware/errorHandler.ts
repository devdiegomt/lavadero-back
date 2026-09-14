import type { Request, Response, NextFunction } from 'express';

/**
 * Error operacional de la API.
 *
 * Lanzar con `throw new AppError('mensaje', statusCode)` en cualquier
 * controller o middleware. El errorHandler global lo captura y responde
 * con el statusCode y mensaje apropiados.
 *
 * `isOperational = true` distingue estos errores de bugs inesperados;
 * solo los bugs se reportan a Sentry como 5xx.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly details: unknown;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, details: unknown = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;

    // Necesario para que instanceof funcione correctamente en subclases de Error
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Shape de error PostgreSQL que nos interesa */
interface PgError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
}

/**
 * Errores de PostgreSQL que significan "el cliente mandó algo inválido".
 *
 * Son la segunda línea: lo primero es validar en el borde con Zod. Pero la
 * validación se pone ruta por ruta y es fácil que una quede sin ella —de hecho
 * 29 rutas estaban así—, y entonces el error llega hasta acá y el cliente recibe
 * un 500. Un 500 dice "me rompí" cuando lo cierto es "me mandaste mal los
 * datos", y además entierra los 500 de verdad en el ruido.
 *
 * Traducirlos acá cubre también las rutas que se agreguen después de que nadie
 * se acuerde de esta conversación.
 */
const ERRORES_DE_ENTRADA: Record<string, string> = {
  // value too long for type character varying(80)
  '22001': 'Uno de los campos excede el largo permitido.',
  // invalid input syntax for type integer / uuid / date
  '22P02': 'Un valor no tiene el formato esperado.',
  // numeric field overflow
  '22003': 'Un número está fuera del rango permitido.',
  // invalid datetime format: "invalid input syntax for type date"
  '22007': 'Una fecha u hora no tiene el formato esperado.',
  // datetime field overflow
  '22008': 'Una fecha u hora no es válida.',
  // violates check constraint
  '23514': 'Los datos no cumplen una regla del sistema.',
  // not-null violation
  '23502': 'Falta un campo obligatorio.',
};

/**
 * Mensajes propios para los CHECK que un usuario puede disparar de verdad.
 *
 * El nombre de la restricción no le sirve a nadie del otro lado; lo que hay que
 * decir es qué regla se rompió y, cuando se puede, qué hacer.
 */
const CHECKS_CONOCIDOS: Record<string, string> = {
  chk_customers_identidad:
    'Un cliente tiene que conservar al menos un teléfono o su WhatsApp. ' +
    'Para borrar sus datos personales está la supresión, que es otra cosa.',
  chk_whatsapp_messages_identidad:
    'Un mensaje de auditoría necesita teléfono o LID.',
  chk_tenants_booking_window:
    'La ventana de reserva tiene que estar entre 1 y 90 días.',
  chk_vehicles_tipo:
    'El tipo de vehículo tiene que ser uno de: sedan, suv, camioneta, moto, pickup. ' +
    'De eso depende qué precio se cobra.',
};

/**
 * ¿Este error de PostgreSQL significa "me mandaste mal los datos"?
 *
 * La usa un `catch` que necesita **dejar pasar** esos errores en vez de
 * convertirlos en un 500 propio. Vive acá, junto a la tabla, para que las dos
 * cosas no se desincronicen: agregar un código a `ERRORES_DE_ENTRADA` alcanza
 * para que ese `catch` también lo reconozca.
 */
export function esErrorDeEntrada(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('code' in err)) return false;
  const codigo = (err as PgError).code;
  return typeof codigo === 'string' && codigo in ERRORES_DE_ENTRADA;
}

/**
 * Middleware de manejo de errores global.
 * Siempre debe ir al final del pipeline de Express (4 parámetros).
 */
export function errorHandler(
  err: PgError | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // En desarrollo conviene ver el error en la consola. **En tests no**: buena
  // parte de la suite comprueba justamente que los errores salgan bien —entrada
  // inválida, credenciales que no sirven, ids que no son UUID— así que cada
  // prueba que pasa imprime su error esperado, con stack.
  //
  // El costo no es estético. Una corrida de CI salió con **9.778 líneas**, casi
  // todas este bloque repetido, y encontrar el fallo de verdad ahí adentro es
  // buscar una aguja. Un log que aparece siempre no lo lee nadie, y cuando hace
  // falta leerlo estorba.
  //
  // El error sigue viajando en la respuesta, que es lo que las pruebas afirman.
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    console.error('❌', err.message);
    if (err.stack && !('isOperational' in err && err.isOperational)) {
      console.error(err.stack);
    }
  }

  // Errores operacionales (los que lanzamos nosotros)
  if ('isOperational' in err && err.isOperational) {
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  // Errores de PostgreSQL — nunca exponer detalles del schema en producción
  if ("code" in err && err.code === '23505') {
    res.status(409).json({
      error: 'El registro ya existe.',
      ...(process.env.NODE_ENV !== 'production' && (err as PgError).detail
        ? { details: (err as PgError).detail }
        : {}),
    });
    return;
  }

  if ("code" in err && err.code === '23503') {
    res.status(400).json({
      error: 'Referencia inválida. El registro relacionado no existe.',
    });
    return;
  }

  const codigo = 'code' in err ? err.code : undefined;
  if (codigo && ERRORES_DE_ENTRADA[codigo]) {
    const pg = err as PgError;
    const mensaje =
      (pg.constraint && CHECKS_CONOCIDOS[pg.constraint]) || ERRORES_DE_ENTRADA[codigo];

    res.status(400).json({
      error: mensaje,
      // El detalle de PostgreSQL nombra columnas y restricciones: útil
      // desarrollando, filtración del esquema en producción.
      ...(process.env.NODE_ENV !== 'production' && pg.detail ? { details: pg.detail } : {}),
    });
    return;
  }

  // Error no esperado (bug)
  res.status(500).json({ error: 'Error interno del servidor.' });
}