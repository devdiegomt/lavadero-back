/**
 * Rastro de acciones del personal.
 *
 * Responde "¿quién cambió esto?", que antes no tenía respuesta fuera de los
 * cambios de estado de un turno.
 *
 * ## Por qué es automático y no una llamada en cada controller
 *
 * Una llamada explícita por acción es más precisa y se olvida. En este mismo
 * proyecto `validateId` existía desde el principio y estaba puesto en **una** de
 * veinte rutas; el cifrado de credenciales tenía la función de descifrar y
 * ninguna de cifrar. Lo que hay que acordarse de poner, no se pone.
 *
 * Así que esto va una vez, arriba, y cubre también las rutas que se agreguen
 * después. El precio es que registra a nivel HTTP —método, ruta, campos— en vez
 * de en términos del negocio. Se paga contento.
 *
 * ## Lo que NO hace
 *
 * - **No guarda valores, sólo nombres de campos.** Guardar valores duplicaría los
 *   datos personales en otra tabla, con su propia obligación de retención, y
 *   arrastraría secretos de paso. Ver la cabecera de `migrate-auditoria.ts`.
 * - **No agrega latencia.** El `INSERT` va después de que la respuesta salió.
 * - **No puede tumbar una petición.** Si falla, se registra en el log y listo: un
 *   fallo de la bitácora no puede impedir que el lavadero trabaje.
 * - **No registra `/api/wa-bridge`.** Ese tráfico no es una persona sino n8n, y
 *   ya tiene su propia auditoría en `whatsapp_messages`. Incluirlo sumaría miles
 *   de filas por día que tapan justamente lo que se viene a ver.
 */
import type { Request, Response, NextFunction } from 'express';
import * as db from '../db';
import logger from '../utils/logger';

/** Métodos que cambian algo. Un GET no se registra: son casi todo el tráfico. */
const METODOS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Rutas que no se registran.
 *
 * - **`wa-bridge`**: no es una persona sino n8n, ya se audita en
 *   `whatsapp_messages`, y sumaría miles de filas por día.
 * - **`auth`**: iniciar sesión no es un cambio, pasa cada 15 minutos por usuario
 *   con el refresh, y esas filas no tienen tenant —el tenant se conoce *después*
 *   de autenticar—, así que quedarían invisibles en el único lector que hay.
 *   Auditar la autenticación es otro problema, con otra forma: se mira por IP y
 *   cruza tenants. Hoy lo que hay es el limitador por `email|IP` del login.
 */
const EXCLUIDAS = [/^\/api\/wa-bridge/, /^\/api\/auth\//];

/**
 * De qué entidad habla la ruta. Sale del primer segmento después de `/api`.
 *
 * `/api/customers/:id/vehicles` cuenta como `customers`: la acción es sobre ese
 * cliente, y es como se va a buscar después.
 *
 * **Se calcula al entrar, no al terminar.** Dentro de `res.on('finish')`
 * `req.path` ya viene reescrito a la ruta relativa del router que atendió
 * (`/` en vez de `/api/customers`), así que calcularlo ahí dejaba `entity` en
 * `null` en todas las filas. El síntoma era una bitácora que se escribía pero no
 * se podía filtrar por entidad, que es la mitad de para qué existe.
 */
function entidadDe(ruta: string): string | null {
  const m = /^\/api\/([a-z-]+)/.exec(ruta);
  return m ? m[1] : null;
}

/**
 * El id de la entidad afectada.
 *
 * En un `PATCH` o un `DELETE` viene en la ruta. En un `POST` todavía no existe
 * cuando llega la petición, así que se saca del cuerpo de la respuesta — que es
 * lo que devuelve el registro recién creado.
 */
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idDe(req: Request, cuerpoRespuesta: unknown): string | null {
  for (const clave of ['id', 'paymentId', 'customerId']) {
    const valor = req.params[clave];
    if (valor && FORMA_UUID.test(valor)) return valor;
  }

  if (cuerpoRespuesta && typeof cuerpoRespuesta === 'object') {
    const id = (cuerpoRespuesta as Record<string, unknown>).id;
    if (typeof id === 'string' && FORMA_UUID.test(id)) return id;
  }

  return null;
}

/** Los nombres de los campos enviados. Sin valores: ver la cabecera. */
function camposDe(body: unknown): string[] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const claves = Object.keys(body as Record<string, unknown>);
  return claves.length > 0 ? claves.slice(0, 50) : null;
}

export function auditarAcciones(req: Request, res: Response, next: NextFunction): void {
  if (!METODOS.has(req.method) || EXCLUIDAS.some((r) => r.test(req.path))) {
    return next();
  }

  // El cuerpo y la entidad se leen ahora, no al terminar:
  //
  // - `req.body` lo reasigna el middleware de validación, y para el rastro
  //   interesa qué se pidió cambiar, no en qué quedó tras normalizarlo.
  // - `req.path` viene reescrito dentro de `res.on('finish')`. Ver `entidadDe`.
  const campos = camposDe(req.body);
  const entidad = entidadDe(req.path);

  // Se interceptan los dos: `res.json` es lo que usa casi todo, pero un 204 o un
  // error que no pasa por el handler salen por `res.send`.
  let cuerpoRespuesta: unknown = null;
  const jsonOriginal = res.json.bind(res);
  res.json = (cuerpo: unknown) => {
    cuerpoRespuesta = cuerpo;
    return jsonOriginal(cuerpo);
  };

  res.on('finish', () => {
    // Después de responder: la bitácora no le agrega un milisegundo a lo que el
    // usuario está esperando.
    void registrar(req, res, campos, entidad, cuerpoRespuesta);
  });

  next();
}

async function registrar(
  req: Request,
  res: Response,
  campos: string[] | null,
  entidad: string | null,
  cuerpoRespuesta: unknown,
): Promise<void> {
  try {
    // `req.route` sólo existe si alguna ruta casó; si no, se usa el path tal
    // cual, que para un 404 es justamente lo que se quiere ver.
    const patron = req.route?.path as string | undefined;
    const ruta = patron ? req.baseUrl + patron : req.path;

    await db.query(
      `INSERT INTO action_log
         (tenant_id, user_id, user_email, user_role, method, route,
          entity, entity_id, status_code, fields, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        req.tenantId ?? req.user?.tenantId ?? null,
        req.user?.id ?? null,
        req.user?.email ?? null,
        req.user?.role ?? null,
        req.method,
        ruta.slice(0, 200),
        entidad,
        idDe(req, cuerpoRespuesta),
        res.statusCode,
        campos,
        // El proxy puede estar delante; `req.ip` respeta `trust proxy` si está
        // configurado, y si no al menos identifica al cliente directo.
        (req.ip ?? '').slice(0, 60) || null,
      ],
    );
  } catch (err) {
    // Nunca propagar: la petición ya terminó, y un fallo de la bitácora no
    // puede traducirse en un error para quien ya recibió su respuesta.
    logger.error({ err, ruta: req.path }, 'No se pudo registrar la acción en la auditoría');
  }
}
