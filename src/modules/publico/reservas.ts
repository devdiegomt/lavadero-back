/**
 * La página pública de reservas de cada lavadero: `/reservar/:slug` en el panel.
 *
 * El cliente final elige servicio, tipo de vehículo, día y hora, deja su nombre,
 * teléfono y placa, autoriza el tratamiento de sus datos, y el turno aparece en
 * la agenda del lavadero como cualquier otro, con `source = 'web'`.
 *
 * Todo corre con el contexto del lavadero ya abierto por `abrirContextoPorSlug`:
 * las consultas de acá pasan por RLS como las del panel.
 *
 * ## Sin verificar el teléfono, y qué lo compensa
 *
 * No hay código por SMS ni por WhatsApp: cuesta plata por reserva y es otra
 * integración que mantener. Sin eso, cualquiera puede escribir cualquier
 * número. Lo que acota el daño:
 *
 * - **No se revela nada.** La respuesta nunca dice si el teléfono o la placa ya
 *   existían, ni a nombre de quién. El nombre de un cliente que ya existe no se
 *   pisa con lo que se escriba acá.
 * - **Tope por teléfono** de reservas pendientes, y **tope diario por lavadero**
 *   de reservas web: llenar la agenda de turnos falsos tiene techo.
 * - **Campo trampa** para los bots que llenan todos los campos de un formulario.
 *
 * No hay límite por IP propio: detrás del balanceador de Render todos los
 * clientes comparten la misma (brecha #7, docs/05-seguridad.md §7), y un tope
 * por IP sería un tope para todo el mundo a la vez.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { estadoDeSuscripcion, type FilaSuscripcion } from '../../shared/middleware/suscripcion';
import { getPlans } from '../../shared/middleware/planLimits';
import { normalizarTelefono } from '../../shared/utils/telefono';
import { centsToPesos, getServicePrice } from '../../shared/utils/pricing';
import {
  diasAgendables,
  etiquetaDeDia,
  getDateInTimezone,
  getMinutesOfDayInTimezone,
} from '../../shared/utils/dateUtils';
import { autorizacionDe, VERSION_AVISO_LAVADERO } from '../whatsapp/consentimiento';
import { registrarAutorizacion } from '../whatsapp/wa-identity';
import type { ServiceRow, VehicleType } from '../../types/entities';

/** Cada cuánto se ofrece una hora de inicio. */
export const PASO_MIN = 30;
/** Si es hoy, lo más pronto que se puede reservar, desde ahora. */
export const MARGEN_MIN = 30;
/** Reservas pendientes que puede tener un mismo teléfono a la vez. */
export const MAX_PENDIENTES_POR_TELEFONO = 2;
/** Reservas web que acepta un lavadero en un día (contando las creadas hoy). */
export const MAX_WEB_POR_DIA = 40;

const TIPOS: VehicleType[] = ['sedan', 'suv', 'camioneta', 'pickup', 'moto'];

const NO_RECIBE =
  'Este lavadero no está recibiendo reservas en línea en este momento. Comunícate directamente con ellos.';

interface Config {
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  timezone: string;
  opening_time: string;
  closing_time: string;
  bays_count: number;
  closed_weekdays: number[] | null;
  booking_days_ahead: number | null;
  plan: string;
}

async function leerConfig(tenantId: string): Promise<Config & FilaSuscripcion> {
  const { rows } = await db.query<Config & FilaSuscripcion>(
    `SELECT name, address, city, phone, timezone, opening_time, closing_time, bays_count,
            closed_weekdays, booking_days_ahead, plan,
            subscription_status, trial_ends_at, discount_pct, discount_until
       FROM tenants WHERE id = $1`,
    [tenantId],
  );
  if (!rows[0]) throw new AppError('Lavadero no encontrado', 404);
  return rows[0];
}

const aMinutos = (hora: string): number => {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + (m || 0);
};
const aHora = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export interface TurnoOcupado {
  /** Minutos desde medianoche. */
  inicio: number;
  minutos: number;
}

/**
 * Las horas de inicio libres de un día. Pura, para poder probarla sin base.
 *
 * Un horario sirve si el servicio **termina antes del cierre** y si, durante
 * todo lo que dura, nunca hay tantos turnos a la vez como bahías. Se mide en el
 * inicio del horario y en cada inicio de otro turno que caiga adentro: la
 * ocupación sólo sube en esos puntos.
 *
 * (El bot de WhatsApp mira sólo si la bahía está libre en el minuto de inicio;
 * con un servicio de tres horas eso ofrece horarios que chocan con turnos que
 * empiezan después.)
 */
export function horasLibres(args: {
  apertura: string;
  cierre: string;
  bahias: number;
  minutosServicio: number;
  ocupados: TurnoOcupado[];
  /** Si la fecha es hoy, minutos desde medianoche en la zona del lavadero. */
  ahora?: number | null;
}): string[] {
  const abre = aMinutos(args.apertura);
  const cierra = aMinutos(args.cierre);
  const dura = Math.max(1, args.minutosServicio);
  const libres: string[] = [];

  for (let inicio = abre; inicio + dura <= cierra; inicio += PASO_MIN) {
    if (args.ahora != null && inicio <= args.ahora + MARGEN_MIN) continue;
    const fin = inicio + dura;
    const puntos = [inicio, ...args.ocupados.map((o) => o.inicio).filter((p) => p > inicio && p < fin)];
    const maxSimultaneos = Math.max(
      ...puntos.map((p) => args.ocupados.filter((o) => o.inicio <= p && p < o.inicio + o.minutos).length),
    );
    if (maxSimultaneos < args.bahias) libres.push(aHora(inicio));
  }
  return libres;
}

/**
 * Turnos que ocupan bahía ese día. Los terminados (`done`) ya la liberaron
 * aunque el carro no se haya entregado; los cancelados y entregados tampoco
 * cuentan. Un turno sin hora —llegó sin reservar— no se puede ubicar en el día
 * y no se cuenta, igual que en el bot.
 */
async function ocupadosDelDia(tenantId: string, fecha: string): Promise<TurnoOcupado[]> {
  const { rows } = await db.query<{ scheduled_time: string; estimated_minutes: number | null }>(
    `SELECT a.scheduled_time, s.estimated_minutes
       FROM appointments a
       JOIN services s ON s.id = a.service_id
      WHERE a.tenant_id = $1
        AND a.scheduled_date = $2
        AND a.scheduled_time IS NOT NULL
        AND a.status NOT IN ('cancelled', 'delivered', 'done')`,
    [tenantId, fecha],
  );
  return rows.map((r) => ({ inicio: aMinutos(r.scheduled_time), minutos: r.estimated_minutes || 60 }));
}

function diasDeLaVentana(cfg: Config): { hoy: string; dias: string[] } {
  const hoy = getDateInTimezone(cfg.timezone);
  return {
    hoy,
    dias: diasAgendables(hoy, cfg.booking_days_ahead ?? 7, cfg.closed_weekdays ?? []),
  };
}

async function horasDe(tenantId: string, cfg: Config, fecha: string, hoy: string, minutos: number) {
  return horasLibres({
    apertura: cfg.opening_time,
    cierre: cfg.closing_time,
    bahias: cfg.bays_count,
    minutosServicio: minutos,
    ocupados: await ocupadosDelDia(tenantId, fecha),
    ahora: fecha === hoy ? getMinutesOfDayInTimezone(cfg.timezone) : null,
  });
}

/** Precio en pesos para ese tipo, o null si el lavadero no lo ofrece (precio 0). */
function precioPara(s: ServiceRow, tipo: VehicleType): number | null {
  const centavos = getServicePrice(s, tipo);
  return centavos > 0 ? centsToPesos(centavos) : null;
}

async function serviciosActivos(tenantId: string): Promise<ServiceRow[]> {
  const { rows } = await db.query<ServiceRow>(
    'SELECT * FROM services WHERE tenant_id = $1 AND is_active = true ORDER BY sort_order, name',
    [tenantId],
  );
  return rows;
}

/**
 * Si el lavadero puede recibir reservas: con la suscripción vencida el panel
 * está en sólo lectura, y una reserva que entre igual no la podría atender
 * nadie desde el panel.
 */
function recibeReservas(cfg: Config & FilaSuscripcion): boolean {
  return !estadoDeSuscripcion(cfg).soloLectura;
}

// ─── GET /api/publico/lavaderos/:slug/reservas ───────────────────────────────

export async function datosParaReservar(req: Request, res: Response): Promise<void> {
  const tenantId = req.tenantId as string;
  const cfg = await leerConfig(tenantId);
  const servicios = await serviciosActivos(tenantId);

  res.json({
    lavadero: {
      nombre: cfg.name,
      direccion: cfg.address,
      ciudad: cfg.city,
      telefono: cfg.phone,
      apertura: cfg.opening_time.slice(0, 5),
      cierre: cfg.closing_time.slice(0, 5),
    },
    recibeReservas: recibeReservas(cfg),
    tipos: TIPOS,
    servicios: servicios
      .map((s) => ({
        id: s.id,
        nombre: s.name,
        descripcion: s.description ?? null,
        minutos: s.estimated_minutes ?? 60,
        precios: Object.fromEntries(TIPOS.map((t) => [t, precioPara(s, t)])),
      }))
      // Un servicio sin precio para ningún tipo no se puede reservar.
      .filter((s) => Object.values(s.precios).some((p) => p !== null)),
  });
}

// ─── GET /api/publico/lavaderos/:slug/reservas/horarios?servicio= ────────────

const uuid = z.string().uuid();

/**
 * Los días de la ventana con sus horas libres, para un servicio. De una vez y
 * no día por día: cada petición anónima gasta del límite global por IP, que
 * hoy comparten todos (brecha #7), así que conviene pedir poco.
 */
export async function horarios(req: Request, res: Response): Promise<void> {
  const servicio = uuid.safeParse(req.query.servicio);
  if (!servicio.success) throw new AppError('Servicio inválido', 400);

  const tenantId = req.tenantId as string;
  const cfg = await leerConfig(tenantId);
  const { rows } = await db.query<ServiceRow>(
    'SELECT * FROM services WHERE tenant_id = $1 AND id = $2 AND is_active = true',
    [tenantId, servicio.data],
  );
  if (!rows[0]) throw new AppError('Servicio no encontrado', 404);
  const minutos = rows[0].estimated_minutes ?? 60;

  const { hoy, dias } = diasDeLaVentana(cfg);
  const resultado = [];
  for (const fecha of dias) {
    const horas = await horasDe(tenantId, cfg, fecha, hoy, minutos);
    if (horas.length > 0) resultado.push({ fecha, etiqueta: etiquetaDeDia(fecha, hoy), horas });
  }
  res.json({ dias: resultado });
}

// ─── POST /api/publico/lavaderos/:slug/reservas ──────────────────────────────

export const esquemaReserva = z.object({
  // Expresa: tiene que venir marcada. Sin esto no se guarda nada (Ley 1581).
  autorizaDatos: z.literal(true, {
    errorMap: () => ({ message: 'Para reservar tienes que autorizar el tratamiento de tus datos' }),
  }),
  servicioId: uuid,
  tipoVehiculo: z.enum(['sedan', 'suv', 'camioneta', 'pickup', 'moto']),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  hora: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida'),
  nombre: z.string().trim().min(2, 'Escribe tu nombre').max(80),
  apellido: z.string().trim().max(80).optional().nullable(),
  telefono: z
    .string()
    .max(20, 'Teléfono muy largo')
    .transform((v) => normalizarTelefono(v) ?? '')
    .refine((v) => /^\+?\d{10,15}$/.test(v), 'Escribe un número de celular válido'),
  placa: z
    .string()
    .max(10)
    .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
    .refine((v) => /^[A-Z]{3}\d{2,3}[A-Z]?$/.test(v), 'Escribe la placa como ABC123 (o ABC12D si es moto)'),
  notas: z.string().trim().max(300).optional().nullable(),
  // Campo trampa: invisible para una persona, un bot lo llena.
  sitio: z.string().optional(),
});
export type CuerpoReserva = z.infer<typeof esquemaReserva>;

export async function reservar(req: Request, res: Response): Promise<void> {
  const b = req.body as CuerpoReserva;
  const tenantId = req.tenantId as string;

  // Un bot llenó el campo trampa. Se le responde como si hubiera funcionado,
  // para que no aprenda a esquivarlo, y no se guarda nada.
  if (b.sitio && b.sitio.trim() !== '') {
    res.status(201).json({ ok: true });
    return;
  }

  const cfg = await leerConfig(tenantId);
  if (!recibeReservas(cfg)) throw new AppError(NO_RECIBE, 409, { codigo: 'NO_RECIBE' });

  const { rows: svc } = await db.query<ServiceRow>(
    'SELECT * FROM services WHERE tenant_id = $1 AND id = $2 AND is_active = true',
    [tenantId, b.servicioId],
  );
  if (!svc[0]) throw new AppError('Ese servicio ya no está disponible', 404);
  const precio = precioPara(svc[0], b.tipoVehiculo);
  if (precio === null) throw new AppError('Ese servicio no está disponible para ese tipo de vehículo', 400);

  const { hoy, dias } = diasDeLaVentana(cfg);
  if (!dias.includes(b.fecha)) throw new AppError('Ese día no se puede reservar', 400);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // Dos personas pidiendo la última bahía al mismo tiempo: la segunda espera
    // aquí y, cuando le toca, ve el turno de la primera.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`reservas:${tenantId}`]);

    const horas = await horasDe(tenantId, cfg, b.fecha, hoy, svc[0].estimated_minutes ?? 60);
    if (!horas.includes(b.hora)) {
      throw new AppError('Ese horario se acaba de ocupar. Elige otro, por favor.', 409, { codigo: 'HORARIO_OCUPADO' });
    }

    // Tope del plan: si se pasó de los turnos del mes, el lavadero no recibe
    // más por acá. El mensaje del plan es para el dueño, no para su cliente.
    const plan = (await getPlans())[cfg.plan];
    if (plan?.max_appointments_month != null) {
      const { rows } = await client.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM appointments
          WHERE tenant_id = $1 AND status != 'cancelled'
            AND scheduled_date >= date_trunc('month', $2::date)
            AND scheduled_date < date_trunc('month', $2::date) + INTERVAL '1 month'`,
        [tenantId, b.fecha],
      );
      if (parseInt(rows[0].n, 10) >= plan.max_appointments_month) {
        throw new AppError(NO_RECIBE, 409, { codigo: 'NO_RECIBE' });
      }
    }

    const { rows: hoyWeb } = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM appointments
        WHERE tenant_id = $1 AND source = 'web'
          AND (created_at AT TIME ZONE $2)::date = $3::date`,
      [tenantId, cfg.timezone, hoy],
    );
    if (parseInt(hoyWeb[0].n, 10) >= MAX_WEB_POR_DIA) {
      throw new AppError(
        'Hoy no se reciben más reservas en línea. Comunícate directamente con el lavadero.',
        429,
        { codigo: 'TOPE_DIARIO' },
      );
    }

    // Cliente: por teléfono. Si ya existe no se le cambia el nombre —quien
    // escribe acá no demostró ser el dueño del número—, y si nunca había
    // autorizado, la autorización queda registrada ahora, sin pisar una previa.
    const aut = autorizacionDe('web', VERSION_AVISO_LAVADERO);
    const { rows: existentes } = await client.query<{ id: string }>(
      'SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL LIMIT 1',
      [tenantId, b.telefono],
    );
    let customerId: string;
    if (existentes[0]) {
      customerId = existentes[0].id;
      await registrarAutorizacion(tenantId, customerId, aut, client.query.bind(client) as typeof db.query);

      const { rows: pend } = await client.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM appointments
          WHERE tenant_id = $1 AND customer_id = $2
            AND status = 'pending' AND scheduled_date >= $3::date`,
        [tenantId, customerId, hoy],
      );
      if (parseInt(pend[0].n, 10) >= MAX_PENDIENTES_POR_TELEFONO) {
        throw new AppError(
          `Ese número ya tiene ${MAX_PENDIENTES_POR_TELEFONO} reservas pendientes. Para cambiarlas o agregar otra, comunícate con el lavadero.`,
          409,
          { codigo: 'TOPE_TELEFONO' },
        );
      }
    } else {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO customers (tenant_id, first_name, last_name, phone, consent_at, consent_version, consent_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [tenantId, b.nombre, b.apellido || null, b.telefono, aut.consentAt, aut.consentVersion, aut.consentSource],
      );
      customerId = rows[0].id;
    }

    // Vehículo: por placa. Si ya existe se usa tal cual; el lavadero corrige
    // el tipo desde el panel si hace falta.
    const { rows: vehs } = await client.query<{ id: string }>(
      'SELECT id FROM vehicles WHERE tenant_id = $1 AND UPPER(plate) = $2 AND deleted_at IS NULL LIMIT 1',
      [tenantId, b.placa],
    );
    let vehicleId: string;
    if (vehs[0]) {
      vehicleId = vehs[0].id;
    } else {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, customerId, b.placa, b.tipoVehiculo],
      );
      vehicleId = rows[0].id;
    }

    // El precio es el que vio el cliente al elegir el tipo de vehículo.
    const { rows: turno } = await client.query<{ id: string }>(
      `INSERT INTO appointments
         (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, scheduled_time, price, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'web') RETURNING id`,
      [tenantId, customerId, vehicleId, b.servicioId, b.fecha, b.hora, getServicePrice(svc[0], b.tipoVehiculo), b.notas || null],
    );
    await client.query(
      `INSERT INTO appointment_status_log (appointment_id, new_status, notes)
       VALUES ($1, 'pending', 'Creado desde la página de reservas')`,
      [turno[0].id],
    );
    await client.query('COMMIT');

    // Sólo lo que la persona escribió o eligió: nada de lo que ya hubiera en
    // la base sobre ese teléfono o esa placa.
    res.status(201).json({
      ok: true,
      lavadero: cfg.name,
      servicio: svc[0].name,
      fecha: b.fecha,
      etiqueta: etiquetaDeDia(b.fecha, hoy),
      hora: b.hora,
      placa: b.placa,
      precio,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
