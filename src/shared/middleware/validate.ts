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

// ─── Helpers reutilizables ────────────────────────────────────────────────────

const uuid = z.string().uuid('ID inválido');

/** Placa colombiana: 3 letras + 2-3 dígitos + 0-1 letra (motos) */
const plate = z
  .string()
  .min(5, 'Placa muy corta')
  .max(7, 'Placa muy larga')
  .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
  .refine((v) => /^[A-Z]{3}\d{2,3}[A-Z]?$/.test(v), 'Formato de placa inválido');

const phone = z
  .string()
  .min(7, 'Teléfono muy corto')
  .max(20, 'Teléfono muy largo')
  .transform((v) => v.trim());

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

const priceCents = z.number().int().min(0, 'El precio no puede ser negativo').default(0);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato: YYYY-MM-DD');

const timeStr = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'Formato: HH:MM')
  .optional()
  .nullable();

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

/**
 * Valida que `req.params.id` sea un UUID válido.
 * Sin esto, IDs malformados provocan errores crípticos en PostgreSQL.
 */
export function validateId(req: Request, _res: Response, next: NextFunction): void {
  const { id } = req.params;
  if (!id) return next();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError('ID inválido. Se espera formato UUID.', 400);
  }

  next();
}