import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { getServicePrice } from '../../shared/utils/pricing';
import { getTenantToday } from '../../shared/utils/dateUtils';
import {
  VALID_TRANSITIONS,
  type AppointmentRow,
  type ServiceRow,
  type AppointmentStatus,
} from '../../types/entities';
import type { AppointmentCreateBody, AppointmentQuickBody, StatusChangeBody } from '../../shared/middleware/validate';

// notifyVehicleReady aún está en JS; se tipará en Fase 4
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { notifyVehicleReady } = require('../whatsapp/notifications') as {
  notifyVehicleReady: (appointmentId: string, tenantId: string) => Promise<void>;
};

// ─── Query de turno con joins (reutilizada en varios handlers) ────────────────

const APPOINTMENT_SELECT = `
  SELECT a.*,
         c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.phone AS customer_phone,
         v.plate, v.vehicle_type, v.brand, v.model, v.color,
         s.name AS service_name, s.estimated_minutes,
         u.first_name AS operator_first_name, u.last_name AS operator_last_name
  FROM appointments a
  JOIN customers c ON c.id = a.customer_id
  JOIN vehicles  v ON v.id = a.vehicle_id
  JOIN services  s ON s.id = a.service_id
  LEFT JOIN users u ON u.id = a.assigned_to`;

// ─── GET /api/appointments ────────────────────────────────────────────────────

export async function list(req: Request, res: Response): Promise<void> {
  const { date, status, page = '1', limit = '50' } = req.query as Record<string, string>;
  const pageN  = parseInt(page, 10);
  const limitN = parseInt(limit, 10);
  const offset = (pageN - 1) * limitN;
  const params: (string | number)[] = [req.tenantId!];
  const conditions = ['a.tenant_id = $1'];

  if (date)   { params.push(date);   conditions.push(`a.scheduled_date = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`a.status = $${params.length}`); }

  const where = conditions.join(' AND ');
  params.push(limitN, offset);

  const { rows } = await db.query(
    `${APPOINTMENT_SELECT} WHERE ${where}
     ORDER BY a.scheduled_time ASC NULLS LAST, a.created_at ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) FROM appointments a WHERE ${where}`,
    params.slice(0, -2),
  );

  res.json({
    data: rows,
    pagination: { total: parseInt(countResult.rows[0].count, 10), page: pageN, limit: limitN },
  });
}

// ─── GET /api/appointments/today ──────────────────────────────────────────────

export async function today(req: Request, res: Response): Promise<void> {
  const todayDate = await getTenantToday(req.tenantId!);

  const { rows } = await db.query(
    `${APPOINTMENT_SELECT}
     WHERE a.tenant_id = $1 AND a.scheduled_date = $2
     ORDER BY
       CASE a.status
         WHEN 'in_progress' THEN 1 WHEN 'pending' THEN 2
         WHEN 'done' THEN 3 WHEN 'delivered' THEN 4 WHEN 'cancelled' THEN 5
       END,
       a.scheduled_time ASC NULLS LAST, a.created_at ASC`,
    [req.tenantId, todayDate],
  );
  res.json(rows);
}

// ─── GET /api/appointments/:id ────────────────────────────────────────────────

export async function getById(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query(
    `SELECT a.*,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name,
            c.phone AS customer_phone, c.email AS customer_email,
            v.plate, v.vehicle_type, v.brand, v.model, v.color, v.year,
            s.name AS service_name, s.estimated_minutes, s.description AS service_description,
            u.first_name AS operator_first_name, u.last_name AS operator_last_name
     FROM appointments a
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles  v ON v.id = a.vehicle_id
     JOIN services  s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = a.assigned_to
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [req.params.id, req.tenantId],
  );

  if (rows.length === 0) throw new AppError('Turno no encontrado', 404);

  const { rows: log } = await db.query(
    `SELECT sl.*, u.first_name, u.last_name
     FROM appointment_status_log sl
     LEFT JOIN users u ON u.id = sl.changed_by
     WHERE sl.appointment_id = $1
     ORDER BY sl.created_at ASC`,
    [req.params.id],
  );

  res.json({ ...rows[0], status_log: log });
}

// ─── POST /api/appointments ───────────────────────────────────────────────────

export async function create(req: Request, res: Response): Promise<void> {
  const { customerId, vehicleId, serviceId, scheduledDate, scheduledTime,
          assignedTo, bayNumber, notes, source } = req.body as AppointmentCreateBody;

  const { rows: serviceRows } = await db.query<ServiceRow>(
    'SELECT * FROM services WHERE id = $1 AND tenant_id = $2 AND is_active = true',
    [serviceId, req.tenantId],
  );
  if (serviceRows.length === 0) throw new AppError('Servicio no encontrado o inactivo', 404);

  const { rows: vehicleRows } = await db.query<{ vehicle_type: AppointmentRow['status'] }>(
    'SELECT vehicle_type FROM vehicles WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [vehicleId, req.tenantId],
  );
  if (vehicleRows.length === 0) throw new AppError('Vehículo no encontrado', 404);

  const price = getServicePrice(serviceRows[0], vehicleRows[0].vehicle_type as never);

  const { rows } = await db.query<AppointmentRow>(
    `INSERT INTO appointments
       (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, scheduled_time,
        assigned_to, bay_number, price, notes, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [req.tenantId, customerId, vehicleId, serviceId, scheduledDate,
     scheduledTime ?? null, assignedTo ?? null, bayNumber ?? null,
     price, notes?.trim() ?? null, source ?? 'walk_in'],
  );

  await db.query(
    `INSERT INTO appointment_status_log (appointment_id, new_status, changed_by)
     VALUES ($1, 'pending', $2)`,
    [rows[0].id, req.user!.id],
  );

  res.status(201).json(rows[0]);
}

// ─── PATCH /api/appointments/:id ──────────────────────────────────────────────

export async function update(req: Request, res: Response): Promise<void> {
  const fieldMap: Record<string, string> = {
    serviceId: 'service_id', scheduledDate: 'scheduled_date',
    scheduledTime: 'scheduled_time', assignedTo: 'assigned_to',
    bayNumber: 'bay_number', notes: 'notes', price: 'price',
  };

  const body = req.body as Record<string, unknown>;
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
    if (body[jsKey] !== undefined) {
      updates.push(`${dbKey} = $${idx}`);
      values.push(body[jsKey]);
      idx++;
    }
  }

  if (updates.length === 0) throw new AppError('No hay campos para actualizar', 400);

  values.push(req.params.id, req.tenantId);
  const { rows } = await db.query<AppointmentRow>(
    `UPDATE appointments SET ${updates.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} AND status NOT IN ('delivered', 'cancelled')
     RETURNING *`,
    values as (string | number | boolean | null)[],
  );

  if (rows.length === 0) throw new AppError('Turno no encontrado o ya finalizado', 404);
  res.json(rows[0]);
}

// ─── PATCH /api/appointments/:id/status ──────────────────────────────────────

const TIMESTAMP_MAP: Partial<Record<AppointmentStatus, string>> = {
  in_progress: 'started_at',
  done:        'completed_at',
  delivered:   'delivered_at',
  cancelled:   'cancelled_at',
};

export async function changeStatus(req: Request, res: Response): Promise<void> {
  const { status: newStatus, notes } = req.body as StatusChangeBody;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: current } = await client.query<Pick<AppointmentRow, 'id' | 'status' | 'customer_id'>>(
      'SELECT id, status, customer_id FROM appointments WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [req.params.id, req.tenantId],
    );

    if (current.length === 0) {
      await client.query('ROLLBACK');
      throw new AppError('Turno no encontrado', 404);
    }

    const currentStatus = current[0].status;
    const validNext = VALID_TRANSITIONS[currentStatus];

    if (!validNext.includes(newStatus)) {
      await client.query('ROLLBACK');
      throw new AppError(
        `No se puede cambiar de "${currentStatus}" a "${newStatus}". ` +
        `Transiciones válidas: ${validNext.length ? validNext.join(', ') : 'ninguna (estado final)'}`,
        400,
      );
    }

    const tsField = TIMESTAMP_MAP[newStatus];
    const tsUpdate = tsField ? `, ${tsField} = NOW()` : '';

    const { rows } = await client.query<AppointmentRow>(
      `UPDATE appointments SET status = $1 ${tsUpdate}
       WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [newStatus, req.params.id, req.tenantId],
    );

    await client.query(
      `INSERT INTO appointment_status_log (appointment_id, previous_status, new_status, changed_by, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, currentStatus, newStatus, req.user!.id, notes ?? null],
    );

    if (newStatus === 'delivered') {
      await client.query(
        `UPDATE customers SET visit_count = visit_count + 1, last_visit_at = NOW() WHERE id = $1`,
        [rows[0].customer_id],
      );
    }

    await client.query('COMMIT');

    if (newStatus === 'done') {
      notifyVehicleReady(req.params.id, req.tenantId!).catch((err: Error) => {
        console.error('[WhatsApp] Error enviando notificación:', err.message);
      });
    }

    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── POST /api/appointments/quick ─────────────────────────────────────────────

export async function quickCreate(req: Request, res: Response): Promise<void> {
  const {
    customerPhone, customerFirstName, customerLastName,
    plate, vehicleType, brand, model, color,
    serviceId, scheduledTime, assignedTo, bayNumber, notes,
  } = req.body as AppointmentQuickBody;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // 1. Buscar o crear cliente
    const { rows: existingCustomers } = await client.query<{ id: string }>(
      'SELECT id FROM customers WHERE phone = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1',
      [customerPhone.trim(), req.tenantId],
    );

    let customerId: string;
    if (existingCustomers.length > 0) {
      customerId = existingCustomers[0].id;
      await client.query(
        'UPDATE customers SET first_name = $1, last_name = $2 WHERE id = $3',
        [customerFirstName.trim(), customerLastName?.trim() ?? null, customerId],
      );
    } else {
      const { rows: newCustomer } = await client.query<{ id: string }>(
        `INSERT INTO customers (tenant_id, first_name, last_name, phone)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.tenantId, customerFirstName.trim(), customerLastName?.trim() ?? null, customerPhone.trim()],
      );
      customerId = newCustomer[0].id;
    }

    // 2. Buscar o crear vehículo
    const { rows: existingVehicles } = await client.query<{ id: string }>(
      'SELECT id FROM vehicles WHERE UPPER(plate) = UPPER($1) AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1',
      [plate.trim(), req.tenantId],
    );

    let vehicleId: string;
    if (existingVehicles.length > 0) {
      vehicleId = existingVehicles[0].id;
    } else {
      const { rows: newVehicle } = await client.query<{ id: string }>(
        `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type, brand, model, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.tenantId, customerId, plate.toUpperCase().trim(),
         vehicleType ?? 'sedan', brand?.trim() ?? null, model?.trim() ?? null, color?.trim() ?? null],
      );
      vehicleId = newVehicle[0].id;
    }

    // 3. Precio del servicio
    const { rows: serviceRows } = await client.query<ServiceRow>(
      'SELECT * FROM services WHERE id = $1 AND tenant_id = $2 AND is_active = true',
      [serviceId, req.tenantId],
    );
    if (serviceRows.length === 0) throw new AppError('Servicio no encontrado o inactivo', 404);

    const { rows: vehRows } = await client.query<{ vehicle_type: string }>(
      'SELECT vehicle_type FROM vehicles WHERE id = $1',
      [vehicleId],
    );
    const price = getServicePrice(serviceRows[0], vehRows[0].vehicle_type as never);

    // 4. Crear turno
    const todayDate = await getTenantToday(req.tenantId!);
    const { rows: appointment } = await client.query<AppointmentRow>(
      `INSERT INTO appointments
         (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, scheduled_time,
          assigned_to, bay_number, price, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'walk_in') RETURNING *`,
      [req.tenantId, customerId, vehicleId, serviceId, todayDate,
       scheduledTime ?? null, assignedTo ?? null, bayNumber ?? null,
       price, notes?.trim() ?? null],
    );

    await client.query(
      `INSERT INTO appointment_status_log (appointment_id, new_status, changed_by)
       VALUES ($1, 'pending', $2)`,
      [appointment[0].id, req.user!.id],
    );

    await client.query('COMMIT');

    // Re-fetch con joins
    const { rows: full } = await db.query(
      `${APPOINTMENT_SELECT} WHERE a.id = $1`,
      [appointment[0].id],
    );

    res.status(201).json(full[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}