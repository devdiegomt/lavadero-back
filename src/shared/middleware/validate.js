/**
 * Validación de input con Zod.
 * 
 * Schemas para los endpoints críticos. El middleware validate()
 * parsea y sanitiza el body antes de llegar al controller.
 * 
 * Uso en routes (misma forma que planLimit/planFeature):
 *   const { validate, validateId, schemas } = require('../../shared/middleware/validate');
 *   router.post('/', validate(schemas.appointmentCreate), asyncHandler(ctrl.create));
 *   router.post('/quick', validate(schemas.appointmentQuick), asyncHandler(ctrl.quickCreate));
 *   router.get('/:id', validateId, asyncHandler(ctrl.getById));
 */

const { z } = require('zod');
const { AppError } = require('./errorHandler');

// ── Helpers reutilizables ────────────────────────────────────────────

const uuid = z.string().uuid('ID inválido');

// Placa colombiana: 3 letras + 2-3 dígitos + 0-1 letra (motos)
const plate = z.string()
  .min(5, 'Placa muy corta').max(7, 'Placa muy larga')
  .transform(v => v.toUpperCase().replace(/[\s\-]/g, ''))
  .refine(v => /^[A-Z]{3}\d{2,3}[A-Z]?$/.test(v), 'Formato de placa inválido');

const phone = z.string().min(7, 'Teléfono muy corto').max(20, 'Teléfono muy largo').transform(v => v.trim());
const optEmail = z.string().email('Email inválido').optional().nullable().transform(v => v?.toLowerCase().trim() || null);
const str = (max = 150) => z.string().max(max).transform(v => v.trim());
const optStr = (max = 150) => z.string().max(max).transform(v => v.trim()).optional().nullable().transform(v => v || null);
const priceCents = z.number().int().min(0, 'El precio no puede ser negativo').default(0);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato: YYYY-MM-DD');
const timeStr = z.string().regex(/^\d{2}:\d{2}$/, 'Formato: HH:MM').optional().nullable();

// ── Schemas por módulo ───────────────────────────────────────────────

const schemas = {
  // Auth
  login: z.object({
    email: z.string().email('Email inválido').transform(v => v.toLowerCase().trim()),
    password: z.string().min(1, 'Contraseña requerida'),
  }),
  refresh: z.object({
    refreshToken: z.string().min(1, 'Refresh token requerido'),
  }),

  // Appointments
  appointmentCreate: z.object({
    customerId: uuid, vehicleId: uuid, serviceId: uuid,
    scheduledDate: dateStr, scheduledTime: timeStr,
    assignedTo: uuid.optional().nullable(),
    bayNumber: z.number().int().min(1).max(20).optional().nullable(),
    notes: optStr(500),
    source: z.enum(['walk_in', 'whatsapp', 'phone', 'web']).default('walk_in'),
  }),
  appointmentQuick: z.object({
    customerPhone: phone, customerFirstName: str(80), customerLastName: optStr(80),
    plate,
    vehicleType: z.enum(['sedan', 'suv', 'camioneta', 'moto', 'pickup']).default('sedan'),
    brand: optStr(50), model: optStr(50), color: optStr(30),
    serviceId: uuid, scheduledTime: timeStr,
    assignedTo: uuid.optional().nullable(),
    bayNumber: z.number().int().min(1).max(20).optional().nullable(),
    notes: optStr(500),
  }),
  statusChange: z.object({
    status: z.enum(['pending', 'in_progress', 'done', 'delivered', 'cancelled'],
      { errorMap: () => ({ message: 'Estado inválido' }) }),
    notes: optStr(500),
  }),

  // Customers
  customerCreate: z.object({
    firstName: str(80), lastName: optStr(80), phone,
    email: optEmail,
    documentType: z.enum(['CC', 'NIT', 'CE', 'PP', 'TI']).default('CC'),
    documentNumber: optStr(20), notes: optStr(1000),
  }),

  // Vehicles
  vehicleCreate: z.object({
    customerId: uuid, plate,
    vehicleType: z.enum(['sedan', 'suv', 'camioneta', 'moto', 'pickup']).default('sedan'),
    brand: optStr(50), model: optStr(50), color: optStr(30),
    year: z.number().int().min(1900).max(2100).optional().nullable(),
    notes: optStr(500),
  }),

  // Services
  serviceCreate: z.object({
    name: str(100), description: optStr(500),
    priceSedan: priceCents, priceSuv: priceCents, priceCamioneta: priceCents,
    priceMoto: priceCents, pricePickup: priceCents,
    estimatedMinutes: z.number().int().min(5).max(600).default(60),
    sortOrder: z.number().int().min(0).max(100).default(0),
  }),

  // Payments
  paymentCreate: z.object({
    appointmentId: uuid,
    amount: z.number().int().positive('El monto debe ser mayor a 0'),
    paymentMethod: z.enum(['cash', 'nequi', 'daviplata', 'transfer', 'card'],
      { errorMap: () => ({ message: 'Método de pago inválido' }) }),
    notes: optStr(500),
  }),

  // Users
  userCreate: z.object({
    email: z.string().email('Email inválido').transform(v => v.toLowerCase().trim()),
    password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
    firstName: str(80), lastName: optStr(80), phone: phone.optional().nullable(),
    role: z.enum(['admin', 'operator']).default('operator'),
  }),
  changePassword: z.object({
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, 'Mínimo 8 caracteres'),
  }),

  // Onboarding — registro self-service de un lavadero nuevo.
  // El body tiene dos secciones: datos del lavadero (tenant) y datos del admin user.
  onboardingRegister: z.object({
    // Datos del lavadero
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
    // Datos del usuario admin
    adminEmail: z.string().email('Email inválido').transform(v => v.toLowerCase().trim()),
    adminPassword: z.string().min(8, 'Mínimo 8 caracteres'),
    adminFirstName: str(80),
    adminLastName: optStr(80),
  }),
};

// ── Middleware factory ────────────────────────────────────────────────

/**
 * Valida req.body (o req.query/req.params) contra un schema Zod.
 * Si falla, lanza AppError 400 con detalle de campos inválidos.
 * Si pasa, reemplaza req[source] con datos parseados y sanitizados.
 * 
 * @param {z.ZodSchema} schema
 * @param {'body' | 'query' | 'params'} source
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const errors = result.error.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      throw new AppError(
        `Datos inválidos: ${errors.map(e => e.message).join('. ')}`,
        400,
        { validation: errors }
      );
    }

    req[source] = result.data;
    next();
  };
}

/**
 * Valida que req.params.id sea un UUID válido.
 * Corrige PEN-005: sin esto, PostgreSQL da error críptico.
 */
function validateId(req, res, next) {
  const id = req.params.id;
  if (!id) return next();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError('ID inválido. Se espera formato UUID.', 400);
  }
  next();
}

module.exports = { validate, validateId, schemas };
