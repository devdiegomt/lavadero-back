import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import type { ServiceRow } from '../../types/entities';

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

// ─── GET /api/wa-bridge/customer-history?phone=XXX ───────────────────────────

export async function getCustomerHistory(req: Request, res: Response): Promise<void> {
  const { phone } = req.query as Record<string, string | undefined>;
  if (!phone) {
    res.status(400).json({ error: 'phone es requerido' });
    return;
  }

  const { rows: customers } = await db.query<{ id: string; first_name: string; last_name: string | null; visit_count: number }>(
    `SELECT id, first_name, last_name, visit_count FROM customers
     WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL LIMIT 1`,
    [req.tenantId, phone.trim()],
  );

  if (!customers[0]) { res.json({ found: false }); return; }
  const customer = customers[0];

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
  const { phone, customerName, plate, brand, model, color, serviceId, scheduledAt } =
    req.body as {
      phone: string; customerName?: string; plate: string;
      brand?: string; model?: string; color?: string;
      serviceId: string; scheduledAt: string;
    };

  if (!phone || !plate || !serviceId || !scheduledAt) {
    res.status(400).json({ error: 'phone, plate, serviceId, scheduledAt son requeridos' });
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

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Upsert cliente
    const { rows: existing } = await client.query<{ id: string }>(
      `SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL LIMIT 1`,
      [req.tenantId, phone],
    );
    let customerId: string;
    if (existing[0]) {
      customerId = existing[0].id;
    } else {
      const parts = (customerName ?? 'Cliente WA').trim().split(' ');
      const { rows: newCust } = await client.query<{ id: string }>(
        `INSERT INTO customers (tenant_id, phone, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.tenantId, phone, parts[0], parts.slice(1).join(' ') || null],
      );
      customerId = newCust[0].id;
    }

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
        `INSERT INTO vehicles (tenant_id, customer_id, plate, brand, model, color) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [req.tenantId, customerId, plate.toUpperCase(), brand ?? null, model ?? null, color ?? null],
      );
      vehicleId = newVeh[0].id;
    }

    // Crear turno
    const { rows: appt } = await client.query<{ id: string; status: string; scheduled_date: string; scheduled_time: string | null }>(
      `INSERT INTO appointments (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, scheduled_time, status, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'whatsapp')
       RETURNING id, status, scheduled_date, scheduled_time`,
      [req.tenantId, customerId, vehicleId, serviceId, scheduledDate, scheduledTime],
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
  const { phone, direction, content, flowStep } = req.body as {
    phone: string; direction: string; content: string; flowStep?: string;
  };

  if (!phone || !direction || !content) {
    res.status(400).json({ error: 'phone, direction y content son requeridos' });
    return;
  }

  const validDirections: MessageDirection[] = ['inbound', 'outbound', 'system'];
  if (!validDirections.includes(direction as MessageDirection)) {
    res.status(400).json({ error: 'direction invalido' });
    return;
  }

  await db.query(
    `INSERT INTO whatsapp_messages (tenant_id, phone, direction, message_type, content, flow_step)
     VALUES ($1, $2, $3, 'text', $4, $5)`,
    [req.tenantId, phone, direction, String(content).substring(0, 2_000), flowStep ?? null],
  );
  res.status(201).json({ ok: true });
}