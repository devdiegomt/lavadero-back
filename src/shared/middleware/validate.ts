/**
 * Validación de input con Zod.
 *
 * Schemas disponibles en `schemas.*`. El middleware `validate(schema)`
 * parsea y sanitiza `req.body` antes de llegar al controller,
 * garantizando tipos correctos y sin valores inseguros.
 *
 * Uso en rutas:
 *   const { validate, validateId, schemas } = require('../../shared/middleware/validate');
 *   router.post('/', validate(schemas.appointmentCreate), asyncHandler(ctrl.create));
 *   router.get('/:id', validateId, asyncHandler(ctrl.getById));
 *
 * Inferir tipos de los schemas para usarlos en controllers:
 *   type CreateAppointmentBody = z.infer<typeof schemas.appointmentCreate>;
 */

import { z } from 'zod';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError } from './errorHandler';
import { normalizarTelefono } from '../utils/telefono';

// ─── Helpers reutilizables ────────────────────────────────────────────────────

const uuid = z.string().uuid('ID inválido');

/** Placa colombiana: 3 letras + 2-3 dígitos + 0-1 letra (motos) */
const plate = z
  .string()
  .min(5, 'Placa muy corta')
  .max(7, 'Placa muy larga')
  .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
  .refine((v) => /^[A-Z]{3}\d{2,3}[A-Z]?$/.test(v), 'Formato de placa inválido');

/**
 * Teléfono en forma canónica. Se normaliza al entrar, igual que la placa: que
 * el mismo número escrito de dos maneras quede como dos clientes distintos es
 * un bug que ya pasó. Ver `utils/telefono.ts`.
 */
const phone = z
  .string()
  .min(7, 'Teléfono muy corto')
  .max(20, 'Teléfono muy largo')
  .transform((v) => normalizarTelefono(v) ?? '')
  .refine((v) => v !== '', 'Teléfono sin dígitos')
  // La normalización casi siempre acorta, pero un valor raro podría no hacerlo
  // y `phone` es VARCHAR(20): mejor 400 que un 500 desde la base.
  .refine((v) => v.length <= 20, 'Teléfono muy largo');

const optEmail = z
  .string()
  .email('Email inválido')
  .optional()
  .nullable()
  .transform((v) => v?.toLowerCase().trim() || null);

const str = (max = 150) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim());

const optStr = (max = 150) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim())
    .optional()
    .nullable()
    .transform((v) => v || null);

/**
 * Versiones de `optStr` y `optEmail` para los `PATCH`.
 *
 * **No son un detalle de estilo.** `optStr` termina en
 * `.optional().nullable().transform(v => v || null)`, y ese transform corre
 * también cuando el campo **no vino**: convierte ausente en `null`. En un alta
 * está bien —lo que no se manda queda vacío— pero en un `PATCH` significa que
 * pedir un cambio de nombre **borra de paso** apellido, email, documento y
 * notas, porque el controller ve la clave presente con valor `null` y la
 * escribe.
 *
 * Acá el `.optional()` va afuera y no hay transform después, así que el campo
 * ausente sigue ausente. Mandar `null` explícito sí lo vacía, que es lo que se
 * espera de un `PATCH`.
 *
 * Se descubrió con la prueba "un PATCH no pisa los campos que no se mandaron",
 * escrita justamente porque era lo que podía salir mal sin hacer ruido.
 */
const optStrParche = (max = 150) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim())
    .nullable()
    .optional();

const optEmailParche = z
  .string()
  .email('Email inválido')
  .transform((v) => v.toLowerCase().trim())
  .nullable()
  .optional();

const priceCents = z.number().int().min(0, 'El precio no puede ser negativo').default(0);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato: YYYY-MM-DD');

/**
 * Fecha que además **existe**. El regex acepta `2026-02-31`, que después se
 * convierte en otra cosa o revienta contra la base según quién la use.
 */
const fechaReal = dateStr.refine((v) => {
  const [a, m, d] = v.split('-').map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  return (
    fecha.getUTCFullYear() === a && fecha.getUTCMonth() === m - 1 && fecha.getUTCDate() === d
  );
}, 'Esa fecha no existe');

/**
 * Hora del día.
 *
 * Dos cosas que parecen detalles y no lo son:
 *
 * - **`99:99` cumple `\d{2}:\d{2}$`.** Pasaba la validación y reventaba contra
 *   la columna `TIME` con un 500. Lo usa también el onboarding, así que ahí
 *   tenía el mismo agujero.
 * - **Los segundos son opcionales.** PostgreSQL devuelve `TIME` como
 *   `"07:00:00"`, el panel lee eso de `GET /tenants/me` y lo reenvía tal cual al
 *   guardar. Exigir `HH:MM` habría devuelto 400 en una pantalla que funciona.
 *   Se normaliza a `HH:MM` para guardar siempre igual.
 */
const timeStr = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Formato: HH:MM')
  .refine((v) => {
    const [h, m, s = 0] = v.split(':').map(Number);
    return h <= 23 && m <= 59 && s <= 59;
  }, 'Esa hora no existe')
  .transform((v) => v.slice(0, 5))
  .optional()
  .nullable();

// ─── Query params ─────────────────────────────────────────────────────────────

/**
 * Los query params se validan **sin cambiarlos de tipo**: siguen siendo texto,
 * porque los controllers hacen su propio `parseInt` y tienen sus propios valores
 * por defecto. Lo único que cambia es que la basura se detiene acá con un 400 en
 * vez de llegar a PostgreSQL y volver como 500.
 *
 * Tope máximo de `limit`. Sin él, `?limit=99999` devuelve la tabla entera y el
 * servidor se la trae a memoria.
 */
const LIMITE_MAXIMO = 200;

const enteroEnTexto = (max: number, nombre: string) =>
  z
    .string()
    .regex(/^\d+$/, `${nombre} debe ser un número entero`)
    .refine((v) => {
      const n = Number(v);
      return n >= 1 && n <= max;
    }, `${nombre} debe estar entre 1 y ${max}`)
    .optional();

/**
 * Arma un schema de query.
 *
 * Dos decisiones que no son obvias:
 *
 * 1. **Una cadena vacía cuenta como ausente.** El panel manda literalmente
 *    `?from=&to=` cuando no hay rango de fechas (ver `PaymentsPage`), y tratar
 *    eso como una fecha inválida rompería una pantalla que hoy funciona.
 * 2. **`passthrough`**: las claves que no se nombran pasan intactas. `validate`
 *    reemplaza `req.query` con lo que devuelve el schema, así que sin esto se
 *    perderían en silencio los params que lee cada controller —`method`,
 *    `period`, `all`— y el síntoma sería un filtro que deja de filtrar. Un
 *    filtro que se ignora calladamente es peor que uno que da error.
 */
function queryDe<T extends z.ZodRawShape>(shape: T) {
  return z.preprocess((entrada) => {
    if (entrada === null || typeof entrada !== 'object') return entrada;
    return Object.fromEntries(
      Object.entries(entrada as Record<string, unknown>).filter((par) => par[1] !== ''),
    );
  }, z.object(shape).passthrough());
}

// ─── Schemas por módulo ───────────────────────────────────────────────────────

export const schemas = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  login: z.object({
    email: z.string().email('Email inválido').transform((v) => v.toLowerCase().trim()),
    password: z.string().min(1, 'Contraseña requerida'),
  }),

  refresh: z.object({
    refreshToken: z.string().min(1, 'Refresh token requerido'),
  }),

  // ── Appointments ──────────────────────────────────────────────────────────
  appointmentCreate: z.object({
    customerId: uuid,
    vehicleId: uuid,
    serviceId: uuid,
    scheduledDate: dateStr,
    scheduledTime: timeStr,
    assignedTo: uuid.optional().nullable(),
    bayNumber: z.number().int().min(1).max(20).optional().nullable(),
    notes: optStr(500),
    source: z.enum(['walk_in', 'whatsapp', 'phone', 'web']).default('walk_in'),
  }),

  appointmentQuick: z.object({
    customerPhone: phone,
    customerFirstName: str(80),
    customerLastName: optStr(80),
    plate,
    vehicleType: z.enum(['sedan', 'suv', 'camioneta', 'moto', 'pickup']).default('sedan'),
    brand: optStr(50),
    model: optStr(50),
    color: optStr(30),
    serviceId: uuid,
    scheduledTime: timeStr,
    assignedTo: uuid.optional().nullable(),
    bayNumber: z.number().int().min(1).max(20).optional().nullable(),
    notes: optStr(500),
  }),

  statusChange: z.object({
    status: z.enum(
      ['pending', 'in_progress', 'done', 'delivered', 'cancelled'],
      { errorMap: () => ({ message: 'Estado inválido' }) },
    ),
    notes: optStr(500),
  }),

  // ── Customers ─────────────────────────────────────────────────────────────
  customerCreate: z.object({
    firstName: str(80),
    lastName: optStr(80),
    phone,
    email: optEmail,
    documentType: z.enum(['CC', 'NIT', 'CE', 'PP', 'TI']).default('CC'),
    documentNumber: optStr(20),
    notes: optStr(1000),
  }),

  // ── Vehicles ──────────────────────────────────────────────────────────────
  vehicleCreate: z.object({
    customerId: uuid,
    plate,
    vehicleType: z.enum(['sedan', 'suv', 'camioneta', 'moto', 'pickup']).default('sedan'),
    brand: optStr(50),
    model: optStr(50),
    color: optStr(30),
    year: z.number().int().min(1900).max(2100).optional().nullable(),
    notes: optStr(500),
  }),

  // ── Services ──────────────────────────────────────────────────────────────
  serviceCreate: z.object({
    name: str(100),
    description: optStr(500),
    priceSedan: priceCents,
    priceSuv: priceCents,
    priceCamioneta: priceCents,
    priceMoto: priceCents,
    pricePickup: priceCents,
    estimatedMinutes: z.number().int().min(5).max(600).default(60),
    sortOrder: z.number().int().min(0).max(100).default(0),
  }),

  // ── Payments ──────────────────────────────────────────────────────────────
  paymentCreate: z.object({
    appointmentId: uuid,
    amount: z.number().int().positive('El monto debe ser mayor a 0'),
    paymentMethod: z.enum(
      ['cash', 'nequi', 'daviplata', 'transfer', 'card'],
      { errorMap: () => ({ message: 'Método de pago inválido' }) },
    ),
    notes: optStr(500),
  }),

  // ── Users ─────────────────────────────────────────────────────────────────
  userCreate: z.object({
    email: z
      .string()
      .email('Email inválido')
      .transform((v) => v.toLowerCase().trim()),
    password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
    firstName: str(80),
    lastName: optStr(80),
    phone: phone.optional().nullable(),
    role: z.enum(['admin', 'operator']).default('operator'),
  }),

  changePassword: z.object({
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, 'Mínimo 8 caracteres'),
  }),

  // ── Onboarding (self-service) ─────────────────────────────────────────────
  onboardingRegister: z.object({
    businessName: str(150),
    nit: optStr(20),
    ownerName: optStr(150),
    phone,
    email: optEmail,
    address: optStr(300),
    city: optStr(100),
    openingTime: timeStr,
    closingTime: timeStr,
    baysCount: z.number().int().min(1).max(20).optional().nullable(),
    adminEmail: z
      .string()
      .email('Email inválido')
      .transform((v) => v.toLowerCase().trim()),
    adminPassword: z.string().min(8, 'Mínimo 8 caracteres'),
    adminFirstName: str(80),
    adminLastName: optStr(80),
  }),

  // ── Query de listados y reportes ──────────────────────────────────────────
  // Lo que hoy devuelve 500 con basura: `?page=abc`, `?limit=-5`,
  // `?from=no-es-fecha`. Ver docs/05-seguridad §7.
  queryListado: queryDe({
    page: enteroEnTexto(100_000, 'page'),
    limit: enteroEnTexto(LIMITE_MAXIMO, 'limit'),
    from: fechaReal.optional(),
    to: fechaReal.optional(),
    date: fechaReal.optional(),
  }),

  // ── Bitácora de acciones ──────────────────────────────────────────────────
  // Los ids se validan como UUID aunque vengan por query: sin eso, un filtro
  // mal escrito llega a PostgreSQL y vuelve como 500.
  queryAuditoria: queryDe({
    page: enteroEnTexto(100_000, 'page'),
    limit: enteroEnTexto(LIMITE_MAXIMO, 'limit'),
    from: fechaReal.optional(),
    to: fechaReal.optional(),
    userId: uuid.optional(),
    entityId: uuid.optional(),
    entity: z.string().max(50).regex(/^[a-z-]+$/, 'Entidad inválida').optional(),
    soloFallidas: z.enum(['true', 'false']).optional(),
  }),

  // ── Cuerpos de PATCH ──────────────────────────────────────────────────────
  //
  // Los `POST` de alta validaban desde siempre; los `PATCH` no, y por ahí
  // entraba lo que el alta rechazaba: un nombre de 5.000 caracteres (500 contra
  // `VARCHAR(80)`), un email que no es email, un tipo de vehículo inventado.
  //
  // Tres reglas que valen para los cinco:
  //
  // 1. **Ningún `.default()`.** En un PATCH un default escribiría un campo que
  //    nadie mandó: pedir un cambio de teléfono terminaría además reseteando el
  //    tipo de documento. Por eso no se derivan de los schemas de alta con
  //    `.partial()`, que arrastraría sus defaults.
  // 2. **`passthrough`.** Cada controller ya tiene su lista de campos
  //    permitidos, que es la que decide qué se puede tocar. Si acá se
  //    descartaran las claves no nombradas, un campo que este schema olvide
  //    dejaría de guardarse **en silencio** — y eso es peor que un 400.
  // 3. **Los mismos límites que el alta**, reusando los mismos helpers. Dos
  //    definiciones del mismo campo son una definición mal.

  customerUpdate: z
    .object({
      firstName: str(80).optional(),
      lastName: optStrParche(80),
      // Se permite vaciarlo: un cliente que llegó por WhatsApp se identifica por
      // su LID. Si no tiene ninguno de los dos, el CHECK de la base lo rechaza y
      // el errorHandler lo traduce a un 400 que explica por qué.
      phone: phone.optional().nullable(),
      email: optEmailParche,
      documentType: z.enum(['CC', 'NIT', 'CE', 'PP', 'TI']).optional(),
      documentNumber: optStrParche(20),
      notes: optStrParche(1000),
    })
    .passthrough(),

  vehicleUpdate: z
    .object({
      plate: plate.optional(),
      // Cerrado a propósito: `getServicePrice` cae a `price_sedan` cuando el
      // tipo no está en el mapa, así que una camioneta mal tipeada se cobraría
      // como sedán. Es plata, no cosmética.
      vehicleType: z.enum(['sedan', 'suv', 'camioneta', 'moto', 'pickup']).optional(),
      brand: optStrParche(50),
      model: optStrParche(50),
      color: optStrParche(30),
      year: z.number().int().min(1900).max(2100).optional().nullable(),
      notes: optStrParche(500),
    })
    .passthrough(),

  serviceUpdate: z
    .object({
      name: str(100).optional(),
      description: optStrParche(500),
      priceSedan: priceCents.optional(),
      priceSuv: priceCents.optional(),
      priceCamioneta: priceCents.optional(),
      priceMoto: priceCents.optional(),
      pricePickup: priceCents.optional(),
      estimatedMinutes: z.number().int().min(5).max(600).optional(),
      sortOrder: z.number().int().min(0).max(100).optional(),
    })
    .passthrough(),

  userUpdate: z
    .object({
      // El email es con lo que se inicia sesión: uno inválido deja la cuenta
      // sin forma de entrar ni de recuperarse.
      email: z
        .string()
        .email('Email inválido')
        .transform((v) => v.toLowerCase().trim())
        .optional(),
      firstName: str(80).optional(),
      lastName: optStrParche(80),
      phone: phone.optional().nullable(),
      role: z.enum(['admin', 'operator']).optional(),
    })
    .passthrough(),

  // Las claves van en snake_case porque la lista de campos permitidos de este
  // controller usa los nombres de las columnas, no los del resto de la API.
  tenantUpdate: z
    .object({
      name: str(150).optional(),
      nit: optStrParche(20),
      owner_name: optStrParche(150),
      phone: phone.optional().nullable(),
      email: optEmailParche,
      address: optStrParche(300),
      city: optStrParche(100),
      opening_time: timeStr,
      closing_time: timeStr,
      bays_count: z.number().int().min(1).max(20).optional(),
      whatsapp_enabled: z.boolean().optional(),
      whatsapp_phone: phone.optional().nullable(),
      whatsapp_provider: optStrParche(20),
    })
    .passthrough(),

  // ── Credenciales de facturación ───────────────────────────────────────────
  // Se validan aunque el módulo `billing` no use Zod en el resto: es un secreto
  // y entra por una ruta nueva, así que no hereda la deuda de las viejas.
  billingCredentials: z.object({
    email: z
      .string()
      .email('El email de Alegra no es válido')
      .transform((v) => v.toLowerCase().trim()),
    // El token de Alegra no se recorta ni se transforma más allá del trim: un
    // secreto que el servidor "arregla" deja de ser el que el usuario pegó.
    token: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length >= 10, 'El token de Alegra parece incompleto')
      // El formato guardado es "email:token": un token con ":" partiría mal al
      // leerlo y el síntoma sería una credencial inválida sin explicación.
      .refine((v) => !v.includes(':'), 'El token no puede contener ":"'),
  }),
} as const;

// ─── Tipos inferidos exportados ───────────────────────────────────────────────
// Los controllers pueden importar estos tipos en lugar de redefinir los shapes.

export type LoginBody               = z.infer<typeof schemas.login>;
export type AppointmentCreateBody   = z.infer<typeof schemas.appointmentCreate>;
export type AppointmentQuickBody    = z.infer<typeof schemas.appointmentQuick>;
export type StatusChangeBody        = z.infer<typeof schemas.statusChange>;
export type CustomerCreateBody      = z.infer<typeof schemas.customerCreate>;
export type VehicleCreateBody       = z.infer<typeof schemas.vehicleCreate>;
export type ServiceCreateBody       = z.infer<typeof schemas.serviceCreate>;
export type PaymentCreateBody       = z.infer<typeof schemas.paymentCreate>;
export type UserCreateBody          = z.infer<typeof schemas.userCreate>;
export type OnboardingRegisterBody  = z.infer<typeof schemas.onboardingRegister>;
export type BillingCredentialsBody  = z.infer<typeof schemas.billingCredentials>;

// ─── Middleware factory ───────────────────────────────────────────────────────

type ValidateSource = 'body' | 'query' | 'params';

/**
 * Valida req.body (o query/params) contra un schema Zod.
 * Si falla → AppError 400 con detalle de campos inválidos.
 * Si pasa → reemplaza req[source] con datos parseados y sanitizados.
 */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  source: ValidateSource = 'body',
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const input =
      source === 'body' ? req.body : source === 'query' ? req.query : req.params;

    const result = schema.safeParse(input);

    if (!result.success) {
      const errors = result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      throw new AppError(
        `Datos inválidos: ${errors.map((e) => e.message).join('. ')}`,
        400,
        { validation: errors },
      );
    }

    if (source === 'body') req.body = result.data as typeof req.body;
    else if (source === 'query') req.query = result.data as typeof req.query;
    else req.params = result.data as typeof req.params;

    next();
  };
}

const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida que los parámetros de ruta indicados sean UUID.
 *
 * Sin esto, un id malformado llega a PostgreSQL, que responde
 * `invalid input syntax for type uuid` y el cliente recibe un **500**. Era el
 * caso de 19 rutas: el middleware existía desde siempre y estaba puesto en una
 * sola. La brecha no era que faltara validación, era que no estaba conectada.
 *
 * Un id con forma válida que no existe sigue dando 404, como antes: esto sólo
 * distingue "no me entendiste" de "no está".
 */
export function validarUuid(...nombres: string[]): RequestHandler {
  const cuales = nombres.length > 0 ? nombres : ['id'];

  return (req: Request, _res: Response, next: NextFunction): void => {
    for (const nombre of cuales) {
      const valor = req.params[nombre];
      // Ausente no es inválido: la misma ruta puede no traer ese parámetro.
      if (!valor) continue;

      if (!FORMA_UUID.test(valor)) {
        throw new AppError(`${nombre} inválido. Se espera formato UUID.`, 400);
      }
    }
    next();
  };
}

/** El caso de siempre: `req.params.id`. */
export const validateId = validarUuid('id');