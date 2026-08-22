import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import type { ServiceRow } from '../../types/entities';
import {
  leerIdentidad,
  tieneIdentidad,
  buscarCliente,
  buscarOCrearCliente,
} from './wa-identity';

// vehicles.vehicle_type: determina cuál columna price_* aplica.
const VEHICLE_TYPES = ['sedan', 'suv', 'camioneta', 'moto', 'pickup'] as const;
type VehicleType = (typeof VEHICLE_TYPES)[number];

// ─── GET /api/wa-bridge/appointment-status?plate=XXX ─────────────────────────

export async function getAppointmentStatus(req: Request, res: Response): Promise<void> {
  const { plate } = req.query as Record<string, string | undefined>;
  if (!plate) {
    res.status(400).json({ error: 'plate es requerido' });
    return;
  }

  const { rows } = await db.query(
    `SELECT a.id, a.status, a.scheduled_date, a.scheduled_time,
            v.plate, v.brand, v.model, v.color,
            s.name AS service_name, s.estimated_minutes,
            u.first_name AS staff_name
     FROM appointments a
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = a.assigned_to
     WHERE a.tenant_id = $1 AND UPPER(v.plate) = UPPER($2)
       AND a.status IN ('pending', 'in_progress')
     ORDER BY a.scheduled_date ASC, a.scheduled_time ASC NULLS LAST
     LIMIT 1`,
    [req.tenantId, plate.trim()],
  );

  if (!rows[0]) { res.json({ found: false }); return; }
  res.json({ found: true, appointment: rows[0] });
}

// ─── GET /api/wa-bridge/services ─────────────────────────────────────────────

export async function getServices(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<Pick<ServiceRow,
    'id' | 'name' | 'description' | 'price_sedan' | 'price_suv' | 'price_camioneta' | 'price_moto' | 'price_pickup' | 'estimated_minutes'
  >>(
    `SELECT id, name, description,
            price_sedan, price_suv, price_camioneta, price_moto, price_pickup,
            estimated_minutes
     FROM services
     WHERE tenant_id = $1 AND is_active = true
     ORDER BY sort_order ASC, name ASC`,
    [req.tenantId],
  );
  res.json({ services: rows });
}

// ─── GET /api/wa-bridge/customer-history?waLid=XXX | ?phone=XXX ──────────────
// WhatsApp no entrega el telefono, asi que el identificador habitual es el
// LID. Se sigue aceptando phone para chats en formato antiguo.

export async function getCustomerHistory(req: Request, res: Response): Promise<void> {
  const identidad = leerIdentidad(req.query as Record<string, unknown>);
  if (!tieneIdentidad(identidad)) {
    res.status(400).json({ error: 'Se requiere waLid o phone' });
    return;
  }

  const customer = await buscarCliente(req.tenantId as string, identidad);
  if (!customer) { res.json({ found: false }); return; }

  const { rows: history } = await db.query(
    `SELECT a.id, a.status, a.scheduled_date, a.scheduled_time, a.price,
            v.plate, v.brand, v.model, s.name AS service_name
     FROM appointments a
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     WHERE a.tenant_id = $1 AND a.customer_id = $2
     ORDER BY a.scheduled_date DESC, a.scheduled_time DESC NULLS LAST
     LIMIT 5`,
    [req.tenantId, customer.id],
  );

  res.json({
    found: true,
    customer: {
      name: `${customer.first_name} ${customer.last_name ?? ''}`.trim(),
      visit_count: customer.visit_count,
    },
    history,
  });
}

// ─── POST /api/wa-bridge/book ─────────────────────────────────────────────────

export async function bookAppointment(req: Request, res: Response): Promise<void> {
  const { customerName, plate, vehicleType, brand, model, color, serviceId, scheduledAt } =
    req.body as {
      customerName?: string; plate: string; vehicleType?: string;
      brand?: string; model?: string; color?: string;
      serviceId: string; scheduledAt: string;
    };

  const identidad = leerIdentidad(req.body as Record<string, unknown>);
  if (!tieneIdentidad(identidad) || !plate || !serviceId || !scheduledAt) {
    res.status(400).json({
      error: '(waLid o phone), plate, serviceId y scheduledAt son requeridos',
    });
    return;
  }

  let scheduledDate: string;
  let scheduledTime: string | null = null;
  if (scheduledAt.includes('T')) {
    const [date, time] = scheduledAt.split('T');
    scheduledDate = date;
    scheduledTime = time ? time.substring(0, 5) : null;
  } else {
    scheduledDate = scheduledAt;
  }

  const type = VEHICLE_TYPES.includes(vehicleType as VehicleType)
    ? (vehicleType as VehicleType)
    : 'sedan';

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // appointments.price es NOT NULL: sin esto todos los turnos quedan en 0.
    // El precio depende del tipo de vehículo (price_sedan, price_suv, ...).
    const { rows: svc } = await client.query<Record<string, number>>(
      `SELECT price_sedan, price_suv, price_camioneta, price_moto, price_pickup
       FROM services WHERE id = $1 AND tenant_id = $2 AND is_active = true LIMIT 1`,
      [serviceId, req.tenantId],
    );
    if (!svc[0]) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Servicio no encontrado' });
      return;
    }
    const price = svc[0][`price_${type}`] ?? svc[0].price_sedan ?? 0;

    // Busca por LID, luego por telefono, y crea si no existe. Enlaza el LID
    // a un cliente que ya estuviera cargado con ese numero.
    const customerId = await buscarOCrearCliente(
      req.tenantId as string,
      identidad,
      customerName ?? null,
      client.query.bind(client) as typeof db.query,
    );

    // Upsert vehículo
    const { rows: existingVeh } = await client.query<{ id: string }>(
      `SELECT id FROM vehicles WHERE tenant_id = $1 AND UPPER(plate) = UPPER($2) AND deleted_at IS NULL LIMIT 1`,
      [req.tenantId, plate],
    );
    let vehicleId: string;
    if (existingVeh[0]) {
      vehicleId = existingVeh[0].id;
    } else {
      const { rows: newVeh } = await client.query<{ id: string }>(
        `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type, brand, model, color) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.tenantId, customerId, plate.toUpperCase(), type, brand ?? null, model ?? null, color ?? null],
      );
      vehicleId = newVeh[0].id;
    }

    // Crear turno
    const { rows: appt } = await client.query<{ id: string; status: string; scheduled_date: string; scheduled_time: string | null }>(
      `INSERT INTO appointments (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, scheduled_time, price, status, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 'whatsapp')
       RETURNING id, status, scheduled_date, scheduled_time, price`,
      [req.tenantId, customerId, vehicleId, serviceId, scheduledDate, scheduledTime, price],
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, appointment: appt[0], customerId, vehicleId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[wa-bridge] Error en bookAppointment:', (err as Error).message);
    res.status(500).json({ error: 'Error al registrar el turno' });
  } finally {
    client.release();
  }
}

// ─── POST /api/wa-bridge/log ──────────────────────────────────────────────────

type MessageDirection = 'inbound' | 'outbound' | 'system';

export async function logMessage(req: Request, res: Response): Promise<void> {
  const { direction, content, flowStep, messageId } = req.body as {
    direction: string; content: string; flowStep?: string; messageId?: string;
  };

  const identidad = leerIdentidad(req.body as Record<string, unknown>);
  if (!tieneIdentidad(identidad) || !direction || !content) {
    res.status(400).json({
      error: '(waLid o phone), direction y content son requeridos',
    });
    return;
  }

  const validDirections: MessageDirection[] = ['inbound', 'outbound', 'system'];
  if (!validDirections.includes(direction as MessageDirection)) {
    res.status(400).json({ error: 'direction invalido' });
    return;
  }

  // phone es VARCHAR(20): un valor más largo reventaría en la BD con un 500.
  if (identidad.phone && identidad.phone.length > 20) {
    res.status(400).json({ error: 'phone excede 20 caracteres' });
    return;
  }

  // messageId va a external_id: permite rastrear la fila hasta el mensaje
  // concreto de WhatsApp. flow_step guarda el intent detectado.
  await db.query(
    `INSERT INTO whatsapp_messages (tenant_id, phone, wa_lid, direction, message_type, content, flow_step, external_id)
     VALUES ($1, $2, $3, $4, 'text', $5, $6, $7)`,
    [
      req.tenantId,
      identidad.phone,
      identidad.waLid ? identidad.waLid.slice(0, 40) : null,
      direction,
      String(content).substring(0, 2_000),
      flowStep ? String(flowStep).substring(0, 50) : null,
      messageId ? String(messageId).substring(0, 100) : null,
    ],
  );
  res.status(201).json({ ok: true });
}