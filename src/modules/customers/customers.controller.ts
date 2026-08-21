import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import type { CustomerRow, VehicleRow } from '../../types/entities';
import type { CustomerCreateBody } from '../../shared/middleware/validate';

// ─── GET /api/customers ───────────────────────────────────────────────────────

export async function list(req: Request, res: Response): Promise<void> {
  const { search, page = '1', limit = '20' } = req.query as Record<string, string>;
  const pageN = parseInt(page, 10);
  const limitN = parseInt(limit, 10);
  const offset = (pageN - 1) * limitN;
  const params: (string | number)[] = [req.tenantId!];
  let where = 'c.tenant_id = $1 AND c.deleted_at IS NULL';

  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    where += ` AND (
      c.first_name ILIKE $${i} OR c.last_name ILIKE $${i} OR c.phone ILIKE $${i} OR
      c.document_number ILIKE $${i} OR
      EXISTS (SELECT 1 FROM vehicles v WHERE v.customer_id = c.id AND v.deleted_at IS NULL AND UPPER(v.plate) ILIKE UPPER($${i}))
    )`;
  }

  const countResult = await db.query<{ count: string }>(`SELECT COUNT(*) FROM customers c WHERE ${where}`, params);

  params.push(limitN, offset);
  type CustomerListRow = CustomerRow & { vehicle_count: string };
  const { rows } = await db.query<CustomerListRow>(
    `SELECT c.id, c.first_name, c.last_name, c.phone, c.email,
            c.document_type, c.document_number, c.notes,
            c.created_at,
            (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id = c.id AND v.deleted_at IS NULL) AS vehicle_count
     FROM customers c
     WHERE ${where}
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  res.json({
    data: rows,
    pagination: { total: parseInt(countResult.rows[0].count, 10), page: pageN, limit: limitN },
  });
}

// ─── GET /api/customers/:id ───────────────────────────────────────────────────

export async function getById(req: Request, res: Response): Promise<void> {
  type CustomerWithVehicles = CustomerRow & { vehicles: VehicleRow[] | null };

  const { rows } = await db.query<CustomerWithVehicles>(
    `SELECT c.*,
            json_agg(
              json_build_object(
                'id', v.id, 'plate', v.plate, 'vehicle_type', v.vehicle_type,
                'brand', v.brand, 'model', v.model, 'color', v.color, 'year', v.year
              ) ORDER BY v.created_at DESC
            ) FILTER (WHERE v.id IS NOT NULL) AS vehicles
     FROM customers c
     LEFT JOIN vehicles v ON v.customer_id = c.id AND v.deleted_at IS NULL
     WHERE c.id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL
     GROUP BY c.id`,
    [req.params.id, req.tenantId],
  );

  if (rows.length === 0) throw new AppError('Cliente no encontrado', 404);
  res.json(rows[0]);
}

// ─── POST /api/customers ──────────────────────────────────────────────────────

export async function create(req: Request, res: Response): Promise<void> {
  const { firstName, lastName, phone, email, documentType, documentNumber, notes } =
    req.body as CustomerCreateBody;

  const { rows } = await db.query<CustomerRow>(
    `INSERT INTO customers (tenant_id, first_name, last_name, phone, email, document_type, document_number, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [req.tenantId, firstName.trim(), lastName?.trim() ?? null, phone.trim(),
     email?.trim() ?? null, documentType ?? 'CC', documentNumber?.trim() ?? null, notes?.trim() ?? null],
  );

  res.status(201).json(rows[0]);
}

// ─── PATCH /api/customers/:id ─────────────────────────────────────────────────

export async function update(req: Request, res: Response): Promise<void> {
  const fieldMap: Record<string, keyof CustomerRow> = {
    firstName: 'first_name', lastName: 'last_name', phone: 'phone',
    email: 'email', documentType: 'document_type', documentNumber: 'document_number', notes: 'notes',
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
  const { rows } = await db.query<CustomerRow>(
    `UPDATE customers SET ${updates.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL RETURNING *`,
    values as (string | number | boolean | null)[],
  );

  if (rows.length === 0) throw new AppError('Cliente no encontrado', 404);
  res.json(rows[0]);
}

// ─── DELETE /api/customers/:id ────────────────────────────────────────────────

export async function remove(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE customers SET deleted_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
    [req.params.id, req.tenantId],
  );

  if (rows.length === 0) throw new AppError('Cliente no encontrado', 404);
  res.json({ message: 'Cliente eliminado' });
}

// ─── GET /api/customers/:id/vehicles ─────────────────────────────────────────

export async function getVehicles(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<VehicleRow>(
    `SELECT * FROM vehicles
     WHERE customer_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [req.params.id, req.tenantId],
  );
  res.json(rows);
}

// ─── GET /api/customers/:id/history ──────────────────────────────────────────

export async function getHistory(req: Request, res: Response): Promise<void> {
  const { page = '1', limit = '20' } = req.query as Record<string, string>;
  const pageN  = parseInt(page, 10);
  const limitN = parseInt(limit, 10);
  const offset = (pageN - 1) * limitN;

  const { rows: cRows } = await db.query<{ id: string }>(
    'SELECT id FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [req.params.id, req.tenantId],
  );
  if (cRows.length === 0) throw new AppError('Cliente no encontrado', 404);

  const countResult = await db.query<{ count: string }>(
    'SELECT COUNT(*) FROM appointments WHERE customer_id = $1',
    [req.params.id],
  );

  const { rows } = await db.query(
    `SELECT a.id, a.scheduled_date, a.scheduled_time, a.status, a.source,
            a.started_at, a.finished_at, a.delivered_at,
            s.name AS service_name,
            v.plate, v.brand, v.model, v.color, v.vehicle_type,
            p.amount AS payment_amount, p.payment_method
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     JOIN vehicles v ON v.id = a.vehicle_id
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.customer_id = $1
     ORDER BY a.scheduled_date DESC, a.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.params.id, limitN, offset],
  );

  type StatsRow = {
    total_visits: string; total_spent: string;
    first_visit: string | null; last_visit: string | null;
    favorite_service: string | null;
  };

  const { rows: stats } = await db.query<StatsRow>(
    `SELECT
       COUNT(*) AS total_visits,
       COALESCE(SUM(p.amount), 0) AS total_spent,
       MIN(a.scheduled_date) AS first_visit,
       MAX(a.scheduled_date) AS last_visit,
       (SELECT s.name FROM appointments a2
        JOIN services s ON s.id = a2.service_id
        WHERE a2.customer_id = $1 AND a2.status = 'delivered'
        GROUP BY s.name ORDER BY COUNT(*) DESC LIMIT 1) AS favorite_service
     FROM appointments a
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.customer_id = $1`,
    [req.params.id],
  );

  res.json({
    data: rows,
    stats: {
      totalVisits:     parseInt(stats[0].total_visits, 10),
      totalSpent:      parseInt(stats[0].total_spent, 10),
      firstVisit:      stats[0].first_visit,
      lastVisit:       stats[0].last_visit,
      favoriteService: stats[0].favorite_service,
    },
    pagination: {
      total: parseInt(countResult.rows[0].count, 10),
      page: pageN,
      limit: limitN,
    },
  });
}