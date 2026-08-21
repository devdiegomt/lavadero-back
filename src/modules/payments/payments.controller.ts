import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import type { PaymentRow, AppointmentRow } from '../../types/entities';
import type { PaymentCreateBody } from '../../shared/middleware/validate';

// ─── GET /api/payments ────────────────────────────────────────────────────────

export async function list(req: Request, res: Response): Promise<void> {
  const { from, to, method, page = '1', limit = '30' } = req.query as Record<string, string>;
  const pageN  = parseInt(page, 10);
  const limitN = parseInt(limit, 10);
  const offset = (pageN - 1) * limitN;
  const params: (string | number)[] = [req.tenantId!];
  const conditions = ['p.tenant_id = $1'];

  if (from)   { params.push(from);              conditions.push(`p.created_at >= $${params.length}::date`); }
  if (to)     { params.push(`${to} 23:59:59`);  conditions.push(`p.created_at <= $${params.length}::timestamp`); }
  if (method) { params.push(method);            conditions.push(`p.payment_method = $${params.length}`); }

  const where = conditions.join(' AND ');
  const countResult = await db.query<{ count: string }>(`SELECT COUNT(*) FROM payments p WHERE ${where}`, params);

  params.push(limitN, offset);
  const { rows } = await db.query(
    `SELECT p.*,
            a.scheduled_date, a.status AS appointment_status,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.phone AS customer_phone,
            v.plate, v.brand, v.model,
            s.name AS service_name,
            u.first_name AS received_by_name
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles  v ON v.id = a.vehicle_id
     JOIN services  s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = p.received_by
     WHERE ${where}
     ORDER BY p.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  res.json({ data: rows, pagination: { total: parseInt(countResult.rows[0].count, 10), page: pageN, limit: limitN } });
}

// ─── GET /api/payments/summary ────────────────────────────────────────────────

export async function summary(req: Request, res: Response): Promise<void> {
  const { from, to } = req.query as Record<string, string>;
  const params: (string | number)[] = [req.tenantId!];
  let dateFilter = '';

  if (from) { params.push(from);             dateFilter += ` AND p.created_at >= $${params.length}::date`; }
  if (to)   { params.push(`${to} 23:59:59`); dateFilter += ` AND p.created_at <= $${params.length}::timestamp`; }

  const [{ rows: totalRows }, { rows: byMethod }, { rows: byDay }, { rows: byService }] =
    await Promise.all([
      db.query<{ count: string; total: string }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM payments p WHERE p.tenant_id = $1 ${dateFilter}`, params),
      db.query<{ payment_method: string; count: string; total: string }>(
        `SELECT payment_method, COUNT(*) AS count, SUM(amount) AS total
         FROM payments p WHERE p.tenant_id = $1 ${dateFilter}
         GROUP BY payment_method ORDER BY total DESC`, params),
      db.query<{ date: string; count: string; total: string }>(
        `SELECT DATE(p.created_at) AS date, COUNT(*) AS count, SUM(amount) AS total
         FROM payments p WHERE p.tenant_id = $1 ${dateFilter}
         GROUP BY DATE(p.created_at) ORDER BY date`, params),
      db.query<{ name: string; count: string; total: string }>(
        `SELECT s.name, COUNT(*) AS count, SUM(p.amount) AS total
         FROM payments p
         JOIN appointments a ON a.id = p.appointment_id
         JOIN services s ON s.id = a.service_id
         WHERE p.tenant_id = $1 ${dateFilter}
         GROUP BY s.name ORDER BY total DESC LIMIT 5`, params),
    ]);

  res.json({
    total:     { count: parseInt(totalRows[0].count, 10), amount: parseInt(totalRows[0].total, 10) },
    byMethod:  byMethod.map(r => ({ method: r.payment_method, count: parseInt(r.count, 10), amount: parseInt(r.total, 10) })),
    byDay:     byDay.map(r => ({ date: r.date, count: parseInt(r.count, 10), amount: parseInt(r.total, 10) })),
    byService: byService.map(r => ({ name: r.name, count: parseInt(r.count, 10), amount: parseInt(r.total, 10) })),
  });
}

// ─── GET /api/payments/:id ────────────────────────────────────────────────────

export async function getById(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query(
    `SELECT p.*,
            a.scheduled_date,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name,
            v.plate, s.name AS service_name
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles  v ON v.id = a.vehicle_id
     JOIN services  s ON s.id = a.service_id
     WHERE p.id = $1 AND p.tenant_id = $2`,
    [req.params.id, req.tenantId],
  );
  if (rows.length === 0) throw new AppError('Pago no encontrado', 404);
  res.json(rows[0]);
}

// ─── POST /api/payments ───────────────────────────────────────────────────────

export async function create(req: Request, res: Response): Promise<void> {
  const { appointmentId, amount, paymentMethod, notes } = req.body as PaymentCreateBody;

  const { rows: aptRows } = await db.query<Pick<AppointmentRow, 'id' | 'status'>>(
    'SELECT id, status FROM appointments WHERE id = $1 AND tenant_id = $2',
    [appointmentId, req.tenantId],
  );
  if (aptRows.length === 0) throw new AppError('Turno no encontrado', 404);

  if (!['done', 'delivered'].includes(aptRows[0].status)) {
    throw new AppError(
      `Solo se puede registrar pago para turnos en estado "done" o "delivered". Estado actual: "${aptRows[0].status}"`,
      400,
    );
  }

  const { rows: existingPayment } = await db.query<{ id: string }>(
    'SELECT id FROM payments WHERE appointment_id = $1',
    [appointmentId],
  );
  if (existingPayment.length > 0) throw new AppError('Este turno ya tiene un pago registrado', 409);

  const { rows } = await db.query<PaymentRow>(
    `INSERT INTO payments (tenant_id, appointment_id, amount, payment_method, received_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.tenantId, appointmentId, amount, paymentMethod, req.user!.id, notes?.trim() ?? null],
  );

  res.status(201).json(rows[0]);
}