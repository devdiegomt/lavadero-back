import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { getTenantUsage } from '../../shared/middleware/planLimits';
import { getTenantToday } from '../../shared/utils/dateUtils';
import type { TenantRow, UserRow } from '../../types/entities';

// ─── Campos permitidos para PATCH /api/tenants/me ────────────────────────────

const ALLOWED_FIELDS: ReadonlyArray<keyof TenantRow> = [
  'name', 'nit', 'owner_name', 'phone', 'email', 'address', 'city',
  'opening_time', 'closing_time', 'bays_count',
  'whatsapp_enabled', 'whatsapp_phone', 'whatsapp_provider',
];

// ─── GET /api/tenants/me ─────────────────────────────────────────────────────

export async function getCurrent(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<TenantRow>(
    `SELECT id, name, slug, nit, owner_name, phone, email, address, city,
            timezone, opening_time, closing_time, bays_count, currency, plan,
            whatsapp_enabled, whatsapp_phone, whatsapp_provider, created_at
     FROM tenants
     WHERE id = $1`,
    [req.tenantId],
  );

  if (rows.length === 0) throw new AppError('Lavadero no encontrado', 404);
  res.json(rows[0]);
}

// ─── PATCH /api/tenants/me ───────────────────────────────────────────────────

export async function updateCurrent(req: Request, res: Response): Promise<void> {
  const body = req.body as Partial<Record<keyof TenantRow, unknown>>;

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const field of ALLOWED_FIELDS) {
    if (body[field] !== undefined) {
      updates.push(`${field} = $${paramIndex}`);
      values.push(body[field]);
      paramIndex++;
    }
  }

  if (updates.length === 0) throw new AppError('No hay campos para actualizar', 400);

  values.push(req.tenantId);

  const { rows } = await db.query<TenantRow>(
    `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values as (string | number | boolean | null)[],
  );

  res.json(rows[0]);
}

// ─── GET /api/tenants/me/stats ───────────────────────────────────────────────

type DayStatsRow = {
  total_appointments: string;
  pending: string;
  in_progress: string;
  done: string;
  delivered: string;
  cancelled: string;
};

type RevenueRow = { total_revenue: string; total_payments: string };

export async function getDayStats(req: Request, res: Response): Promise<void> {
  const todayDate = await getTenantToday(req.tenantId!); // bugfix: era `today` (undefined)

  const { rows } = await db.query<DayStatsRow>(
    `SELECT
       COUNT(*) AS total_appointments,
       COUNT(*) FILTER (WHERE status = 'pending') AS pending,
       COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
       COUNT(*) FILTER (WHERE status = 'done') AS done,
       COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
     FROM appointments
     WHERE tenant_id = $1 AND scheduled_date = $2`,
    [req.tenantId, todayDate],
  );

  const { rows: revenueRows } = await db.query<RevenueRow>(
    `SELECT COALESCE(SUM(p.amount), 0) AS total_revenue, COUNT(p.id) AS total_payments
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     WHERE a.tenant_id = $1 AND a.scheduled_date = $2`,
    [req.tenantId, todayDate],
  );

  res.json({
    date: todayDate,
    appointments: rows[0],
    revenue: {
      total: parseInt(revenueRows[0].total_revenue, 10),
      payments: parseInt(revenueRows[0].total_payments, 10),
    },
  });
}

// ─── GET /api/tenants/me/operators ───────────────────────────────────────────

type OperatorRow = Pick<UserRow, 'id' | 'first_name' | 'last_name' | 'phone' | 'role' | 'is_active'>;

export async function getOperators(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<OperatorRow>(
    `SELECT id, first_name, last_name, phone, role, is_active
     FROM users
     WHERE tenant_id = $1 AND is_active = true
     ORDER BY first_name`,
    [req.tenantId],
  );
  res.json(rows);
}

// ─── GET /api/tenants/me/usage ───────────────────────────────────────────────

export async function getUsage(req: Request, res: Response): Promise<void> {
  const usage = await getTenantUsage(req.tenantId!);
  if (!usage) throw new AppError('No se pudo obtener el uso del tenant', 404);
  res.json(usage);
}