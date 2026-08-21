import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import type { VehicleRow, CustomerRow } from '../../types/entities';
import type { VehicleCreateBody } from '../../shared/middleware/validate';

type VehicleWithCustomer = VehicleRow & {
  customer_first_name: string;
  customer_last_name: string | null;
  customer_phone: string;
  customer_email?: string | null;
};

const FIELD_MAP: Record<string, keyof VehicleRow> = {
  plate: 'plate', vehicleType: 'vehicle_type', brand: 'brand',
  model: 'model', color: 'color', year: 'year',
};

// ─── GET /api/vehicles ────────────────────────────────────────────────────────

export async function list(req: Request, res: Response): Promise<void> {
  const { search, page = '1', limit = '20' } = req.query as Record<string, string>;
  const pageN  = parseInt(page, 10);
  const limitN = parseInt(limit, 10);
  const offset = (pageN - 1) * limitN;
  const params: (string | number)[] = [req.tenantId!];
  let where = 'v.tenant_id = $1 AND v.deleted_at IS NULL';

  if (search) {
    params.push(`%${search.toUpperCase()}%`);
    where += ` AND (UPPER(v.plate) ILIKE $${params.length} OR v.brand ILIKE $${params.length} OR v.model ILIKE $${params.length})`;
  }

  const countResult = await db.query<{ count: string }>(`SELECT COUNT(*) FROM vehicles v WHERE ${where}`, params);

  params.push(limitN, offset);
  const { rows } = await db.query<VehicleWithCustomer>(
    `SELECT v.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.phone AS customer_phone
     FROM vehicles v
     JOIN customers c ON c.id = v.customer_id
     WHERE ${where}
     ORDER BY v.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  res.json({ data: rows, pagination: { total: parseInt(countResult.rows[0].count, 10), page: pageN, limit: limitN } });
}

// ─── GET /api/vehicles/plate/:plate ──────────────────────────────────────────

export async function getByPlate(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<VehicleWithCustomer>(
    `SELECT v.*, c.id AS customer_id, c.first_name AS customer_first_name,
            c.last_name AS customer_last_name, c.phone AS customer_phone, c.email AS customer_email
     FROM vehicles v
     JOIN customers c ON c.id = v.customer_id
     WHERE UPPER(v.plate) = UPPER($1) AND v.tenant_id = $2 AND v.deleted_at IS NULL
     LIMIT 1`,
    [req.params.plate.trim(), req.tenantId],
  );

  if (rows.length === 0) throw new AppError('Vehículo no encontrado', 404);
  res.json(rows[0]);
}

// ─── GET /api/vehicles/:id ────────────────────────────────────────────────────

export async function getById(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<VehicleWithCustomer>(
    `SELECT v.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.phone AS customer_phone
     FROM vehicles v
     JOIN customers c ON c.id = v.customer_id
     WHERE v.id = $1 AND v.tenant_id = $2 AND v.deleted_at IS NULL`,
    [req.params.id, req.tenantId],
  );

  if (rows.length === 0) throw new AppError('Vehículo no encontrado', 404);
  res.json(rows[0]);
}

// ─── POST /api/vehicles ───────────────────────────────────────────────────────

export async function create(req: Request, res: Response): Promise<void> {
  const { customerId, plate, vehicleType, brand, model, color, year } =
    req.body as VehicleCreateBody;

  const { rows: customerRows } = await db.query<Pick<CustomerRow, 'id'>>(
    'SELECT id FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [customerId, req.tenantId],
  );
  if (customerRows.length === 0) throw new AppError('Cliente no encontrado', 404);

  const { rows } = await db.query<VehicleRow>(
    `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type, brand, model, color, year)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [req.tenantId, customerId, plate.toUpperCase().trim(),
     vehicleType ?? 'sedan', brand?.trim() ?? null, model?.trim() ?? null,
     color?.trim() ?? null, year ?? null],
  );

  res.status(201).json(rows[0]);
}

// ─── PATCH /api/vehicles/:id ──────────────────────────────────────────────────

export async function update(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [jsKey, dbKey] of Object.entries(FIELD_MAP)) {
    if (body[jsKey] !== undefined) {
      let val = body[jsKey];
      if (dbKey === 'plate') val = (val as string).toUpperCase().trim();
      updates.push(`${dbKey} = $${idx}`);
      values.push(val);
      idx++;
    }
  }

  if (updates.length === 0) throw new AppError('No hay campos para actualizar', 400);

  values.push(req.params.id, req.tenantId);
  const { rows } = await db.query<VehicleRow>(
    `UPDATE vehicles SET ${updates.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL RETURNING *`,
    values as (string | number | boolean | null)[],
  );

  if (rows.length === 0) throw new AppError('Vehículo no encontrado', 404);
  res.json(rows[0]);
}

// ─── DELETE /api/vehicles/:id ─────────────────────────────────────────────────

export async function remove(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE vehicles SET deleted_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
    [req.params.id, req.tenantId],
  );
  if (rows.length === 0) throw new AppError('Vehículo no encontrado', 404);
  res.json({ message: 'Vehículo eliminado' });
}

// ─── GET /api/vehicles/:id/history ───────────────────────────────────────────

export async function getHistory(req: Request, res: Response): Promise<void> {
  const { page = '1', limit = '20' } = req.query as Record<string, string>;
  const pageN  = parseInt(page, 10);
  const limitN = parseInt(limit, 10);
  const offset = (pageN - 1) * limitN;

  const { rows: vRows } = await db.query<{ id: string }>(
    'SELECT id FROM vehicles WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [req.params.id, req.tenantId],
  );
  if (vRows.length === 0) throw new AppError('Vehículo no encontrado', 404);

  const countResult = await db.query<{ count: string }>(
    'SELECT COUNT(*) FROM appointments WHERE vehicle_id = $1',
    [req.params.id],
  );

  const { rows } = await db.query(
    `SELECT a.id, a.scheduled_date, a.scheduled_time, a.status, a.source, a.notes,
            a.started_at, a.finished_at, a.delivered_at, a.created_at,
            s.name AS service_name, s.estimated_minutes,
            u.first_name AS operator_first_name, u.last_name AS operator_last_name,
            p.amount AS payment_amount, p.payment_method,
            EXTRACT(EPOCH FROM (a.finished_at - a.started_at)) / 60 AS actual_minutes
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = a.assigned_to
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.vehicle_id = $1
     ORDER BY a.scheduled_date DESC, a.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.params.id, limitN, offset],
  );

  type VehicleStatsRow = {
    total_visits: string; completed_visits: string; total_spent: string;
    first_visit: string | null; last_visit: string | null; avg_minutes: string | null;
  };

  const { rows: stats } = await db.query<VehicleStatsRow>(
    `SELECT
       COUNT(*) AS total_visits,
       COUNT(*) FILTER (WHERE status = 'delivered') AS completed_visits,
       COALESCE(SUM(p.amount), 0) AS total_spent,
       MIN(a.scheduled_date) AS first_visit,
       MAX(a.scheduled_date) AS last_visit,
       AVG(EXTRACT(EPOCH FROM (a.finished_at - a.started_at)) / 60)
         FILTER (WHERE a.finished_at IS NOT NULL AND a.started_at IS NOT NULL) AS avg_minutes
     FROM appointments a
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.vehicle_id = $1`,
    [req.params.id],
  );

  res.json({
    data: rows,
    stats: {
      totalVisits:     parseInt(stats[0].total_visits, 10),
      completedVisits: parseInt(stats[0].completed_visits, 10),
      totalSpent:      parseInt(stats[0].total_spent, 10),
      firstVisit:      stats[0].first_visit,
      lastVisit:       stats[0].last_visit,
      avgMinutes:      stats[0].avg_minutes ? Math.round(parseFloat(stats[0].avg_minutes)) : null,
    },
    pagination: { total: parseInt(countResult.rows[0].count, 10), page: pageN, limit: limitN },
  });
}