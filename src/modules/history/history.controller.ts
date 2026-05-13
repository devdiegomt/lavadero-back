import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';

// ─── GET /api/history/vehicle/:plate ─────────────────────────────────────────

export async function vehicleHistory(req: Request, res: Response): Promise<void> {
  const { from, to, page = '1', limit = '20' } = req.query as Record<string, string>;
  const pageN  = parseInt(page, 10);
  const limitN = parseInt(limit, 10);
  const offset = (pageN - 1) * limitN;

  type VehicleRow = {
    id: string; plate: string; vehicle_type: string; brand: string | null;
    model: string | null; color: string | null; year: number | null;
    customer_first_name: string; customer_last_name: string | null;
    customer_phone: string; customer_email: string | null; customer_id: string;
  };

  const { rows: vehicleRows } = await db.query<VehicleRow>(
    `SELECT v.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name,
            c.phone AS customer_phone, c.email AS customer_email, c.id AS customer_id
     FROM vehicles v
     JOIN customers c ON c.id = v.customer_id
     WHERE UPPER(v.plate) = UPPER($1) AND v.tenant_id = $2 AND v.deleted_at IS NULL`,
    [req.params.plate.trim(), req.tenantId],
  );

  if (vehicleRows.length === 0) throw new AppError('Vehículo no encontrado', 404);
  const vehicle = vehicleRows[0];

  const params: (string | number)[] = [vehicle.id];
  let dateFilter = '';
  if (from) { params.push(from); dateFilter += ` AND a.scheduled_date >= $${params.length}`; }
  if (to)   { params.push(to);   dateFilter += ` AND a.scheduled_date <= $${params.length}`; }

  type StatsRow = {
    total_visits: string; completed_visits: string; total_spent: string;
    first_visit: string | null; last_visit: string | null; avg_service_minutes: string | null;
  };

  const [{ rows: statsRows }, { rows: countRows }] = await Promise.all([
    db.query<StatsRow>(
      `SELECT
         COUNT(*) AS total_visits,
         COUNT(*) FILTER (WHERE a.status = 'delivered') AS completed_visits,
         COALESCE(SUM(p.amount), 0) AS total_spent,
         MIN(a.scheduled_date) AS first_visit,
         MAX(a.scheduled_date) AS last_visit,
         AVG(EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) / 60)
           FILTER (WHERE a.completed_at IS NOT NULL AND a.started_at IS NOT NULL) AS avg_service_minutes
       FROM appointments a
       LEFT JOIN payments p ON p.appointment_id = a.id
       WHERE a.vehicle_id = $1 ${dateFilter}`,
      params,
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*) FROM appointments a WHERE a.vehicle_id = $1 ${dateFilter}`,
      params,
    ),
  ]);

  const listParams = [...params, limitN, offset];
  const { rows: appointments } = await db.query(
    `SELECT a.id, a.scheduled_date, a.scheduled_time, a.status, a.price, a.source, a.notes,
            a.started_at, a.completed_at, a.delivered_at, a.created_at,
            s.name AS service_name, s.estimated_minutes,
            u.first_name AS operator_first_name, u.last_name AS operator_last_name,
            p.amount AS paid_amount, p.payment_method, p.created_at AS paid_at
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = a.assigned_to
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.vehicle_id = $1 ${dateFilter}
     ORDER BY a.scheduled_date DESC, a.created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );

  const { rows: topService } = await db.query<{ name: string }>(
    `SELECT s.name FROM appointments a
     JOIN services s ON s.id = a.service_id
     WHERE a.vehicle_id = $1 AND a.status = 'delivered'
     GROUP BY s.name ORDER BY COUNT(*) DESC LIMIT 1`,
    [vehicle.id],
  );

  const s = statsRows[0];
  res.json({
    vehicle: {
      id: vehicle.id, plate: vehicle.plate, vehicle_type: vehicle.vehicle_type,
      brand: vehicle.brand, model: vehicle.model, color: vehicle.color, year: vehicle.year,
    },
    customer: {
      id: vehicle.customer_id, first_name: vehicle.customer_first_name,
      last_name: vehicle.customer_last_name, phone: vehicle.customer_phone, email: vehicle.customer_email,
    },
    stats: {
      total_visits:       parseInt(s.total_visits, 10),
      completed_visits:   parseInt(s.completed_visits, 10),
      total_spent:        parseInt(s.total_spent, 10),
      first_visit:        s.first_visit,
      last_visit:         s.last_visit,
      avg_service_minutes: s.avg_service_minutes ? Math.round(parseFloat(s.avg_service_minutes)) : null,
      favorite_service:   topService[0]?.name ?? null,
    },
    appointments,
    pagination: { total: parseInt(countRows[0].count, 10), page: pageN, limit: limitN },
  });
}

// ─── GET /api/history/customer/:id ───────────────────────────────────────────

export async function customerHistory(req: Request, res: Response): Promise<void> {
  const { page = '1', limit = '20' } = req.query as Record<string, string>;
  const pageN  = parseInt(page, 10);
  const limitN = parseInt(limit, 10);
  const offset = (pageN - 1) * limitN;

  type CustomerRow = {
    id: string; first_name: string; last_name: string | null; phone: string;
    email: string | null; document_type: string; document_number: string | null;
    notes: string | null; created_at: Date; vehicle_count: string;
  };

  const { rows: custRows } = await db.query<CustomerRow>(
    `SELECT c.*, (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id = c.id AND v.deleted_at IS NULL) AS vehicle_count
     FROM customers c
     WHERE c.id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL`,
    [req.params.id, req.tenantId],
  );
  if (custRows.length === 0) throw new AppError('Cliente no encontrado', 404);
  const customer = custRows[0];

  type StatsRow = { total_visits: string; total_spent: string; first_visit: string | null; last_visit: string | null };
  type MonthRow = { month: Date; total: string };

  const [{ rows: vehicles }, { rows: statsRows }, { rows: appointments }, { rows: countRows }, { rows: monthlySpend }] =
    await Promise.all([
      db.query(
        `SELECT id, plate, vehicle_type, brand, model, color, year
         FROM vehicles WHERE customer_id = $1 AND tenant_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [req.params.id, req.tenantId],
      ),
      db.query<StatsRow>(
        `SELECT COUNT(*) AS total_visits, COALESCE(SUM(p.amount), 0) AS total_spent,
                MIN(a.scheduled_date) AS first_visit, MAX(a.scheduled_date) AS last_visit
         FROM appointments a
         LEFT JOIN payments p ON p.appointment_id = a.id
         WHERE a.customer_id = $1 AND a.tenant_id = $2`,
        [req.params.id, req.tenantId],
      ),
      db.query(
        `SELECT a.id, a.scheduled_date, a.scheduled_time, a.status, a.price, a.notes,
                a.started_at, a.completed_at, a.delivered_at,
                v.plate, v.vehicle_type, v.brand, v.model, v.color,
                s.name AS service_name,
                p.amount AS paid_amount, p.payment_method
         FROM appointments a
         JOIN vehicles v ON v.id = a.vehicle_id
         JOIN services s ON s.id = a.service_id
         LEFT JOIN payments p ON p.appointment_id = a.id
         WHERE a.customer_id = $1 AND a.tenant_id = $2
         ORDER BY a.scheduled_date DESC, a.created_at DESC
         LIMIT $3 OFFSET $4`,
        [req.params.id, req.tenantId, limitN, offset],
      ),
      db.query<{ count: string }>(
        'SELECT COUNT(*) FROM appointments WHERE customer_id = $1 AND tenant_id = $2',
        [req.params.id, req.tenantId],
      ),
      db.query<MonthRow>(
        `SELECT DATE_TRUNC('month', a.scheduled_date) AS month, COALESCE(SUM(p.amount), 0) AS total
         FROM appointments a
         LEFT JOIN payments p ON p.appointment_id = a.id
         WHERE a.customer_id = $1 AND a.tenant_id = $2 AND a.scheduled_date >= NOW() - interval '6 months'
         GROUP BY month ORDER BY month`,
        [req.params.id, req.tenantId],
      ),
    ]);

  const s = statsRows[0];
  res.json({
    customer: {
      id: customer.id, first_name: customer.first_name, last_name: customer.last_name,
      phone: customer.phone, email: customer.email, document_type: customer.document_type,
      document_number: customer.document_number, notes: customer.notes, created_at: customer.created_at,
    },
    vehicles,
    stats: {
      total_visits:   parseInt(s.total_visits, 10),
      total_spent:    parseInt(s.total_spent, 10),
      first_visit:    s.first_visit,
      last_visit:     s.last_visit,
      vehicle_count:  parseInt(customer.vehicle_count, 10),
    },
    monthlySpend: monthlySpend.map((r) => ({ month: r.month, total: parseInt(r.total, 10) })),
    appointments,
    pagination: { total: parseInt(countRows[0].count, 10), page: pageN, limit: limitN },
  });
}

// ─── GET /api/history/search ──────────────────────────────────────────────────

export async function search(req: Request, res: Response): Promise<void> {
  const { q } = req.query as Record<string, string | undefined>;
  if (!q || q.trim().length < 2) {
    res.json({ vehicles: [], customers: [] });
    return;
  }

  const term = `%${q.trim()}%`;

  const [{ rows: vehicles }, { rows: customers }] = await Promise.all([
    db.query(
      `SELECT v.id, v.plate, v.vehicle_type, v.brand, v.model, v.color,
              c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.phone AS customer_phone
       FROM vehicles v
       JOIN customers c ON c.id = v.customer_id
       WHERE v.tenant_id = $1 AND v.deleted_at IS NULL
         AND (UPPER(v.plate) ILIKE UPPER($2) OR v.brand ILIKE $2 OR v.model ILIKE $2)
       ORDER BY v.plate LIMIT 5`,
      [req.tenantId, term],
    ),
    db.query(
      `SELECT c.id, c.first_name, c.last_name, c.phone, c.email,
              (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id = c.id AND v.deleted_at IS NULL) AS vehicle_count
       FROM customers c
       WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
         AND (c.first_name ILIKE $2 OR c.last_name ILIKE $2 OR c.phone ILIKE $2 OR c.document_number ILIKE $2)
       ORDER BY c.first_name LIMIT 5`,
      [req.tenantId, term],
    ),
  ]);

  res.json({ vehicles, customers });
}