import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { getTenantUsage } from '../../shared/middleware/planLimits';
import type { TenantRow, PlanRow, PlanId } from '../../types/entities';
import type { SuperAdminDashboardDto, TenantListItemDto } from '../../types/api';

// ─── GET /api/superadmin/tenants ─────────────────────────────────────────────

export async function listTenants(req: Request, res: Response): Promise<void> {
  const { page = '1', limit = '20', search, plan, status } =
    req.query as Record<string, string | undefined>;
  const pageN  = parseInt(page, 10);
  const limitN = parseInt(limit, 10);
  const offset = (pageN - 1) * limitN;

  const params: (string | number)[] = [];
  const conditions: string[] = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(t.name ILIKE $${params.length} OR t.slug ILIKE $${params.length} OR t.email ILIKE $${params.length} OR t.nit ILIKE $${params.length})`);
  }
  if (plan)              { params.push(plan);  conditions.push(`t.plan = $${params.length}`); }
  if (status === 'active')   conditions.push('t.is_active = true');
  if (status === 'inactive') conditions.push('t.is_active = false');

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const { rows: countRows } = await db.query<{ count: string }>(`SELECT COUNT(*) FROM tenants t ${where}`, params);

  params.push(limitN, offset);

  type TenantListRow = TenantRow & {
    user_count: string; today_appointments: string; month_revenue: string;
  };

  const { rows } = await db.query<TenantListRow>(
    `SELECT t.*,
            (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.is_active = true) AS user_count,
            (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id = t.id AND a.scheduled_date = CURRENT_DATE) AS today_appointments,
            (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.tenant_id = t.id AND p.created_at >= DATE_TRUNC('month', NOW())) AS month_revenue
     FROM tenants t ${where}
     ORDER BY t.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const data: TenantListItemDto[] = rows.map((t) => ({
    id: t.id, name: t.name, slug: t.slug, nit: t.nit, ownerName: t.owner_name,
    phone: t.phone, email: t.email, city: t.city,
    plan: t.plan, isActive: t.is_active,
    trialEndsAt: t.trial_ends_at?.toISOString() ?? null,
    whatsappEnabled: t.whatsapp_enabled, billingProvider: t.billing_provider,
    userCount:         parseInt(t.user_count, 10),
    todayAppointments: parseInt(t.today_appointments, 10),
    monthRevenue:      parseInt(t.month_revenue, 10),
    createdAt:         t.created_at.toISOString(),
  }));

  res.json({ data, pagination: { total: parseInt(countRows[0].count, 10), page: pageN, limit: limitN } });
}

// ─── GET /api/superadmin/tenants/:id ─────────────────────────────────────────

export async function getTenantDetail(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<TenantRow>('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
  if (rows.length === 0) throw new AppError('Tenant no encontrado', 404);

  const tenant = rows[0];
  const usage = await getTenantUsage(tenant.id);

  type UserRow = { id: string; email: string; first_name: string; last_name: string | null; role: string; is_active: boolean; last_login_at: Date | null };
  type StatsRow = { customers: string; vehicles: string; total_appointments: string; total_payments: string; total_revenue: string };
  type OnboardRow = { step: string; created_at: Date };

  const [{ rows: users }, { rows: stats }, { rows: onboarding }] = await Promise.all([
    db.query<UserRow>('SELECT id, email, first_name, last_name, role, is_active, last_login_at FROM users WHERE tenant_id = $1 ORDER BY role, first_name', [tenant.id]),
    db.query<StatsRow>(`
      SELECT
        (SELECT COUNT(*) FROM customers WHERE tenant_id = $1 AND deleted_at IS NULL) AS customers,
        (SELECT COUNT(*) FROM vehicles WHERE tenant_id = $1 AND deleted_at IS NULL) AS vehicles,
        (SELECT COUNT(*) FROM appointments WHERE tenant_id = $1) AS total_appointments,
        (SELECT COUNT(*) FROM payments WHERE tenant_id = $1) AS total_payments,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE tenant_id = $1) AS total_revenue`, [tenant.id]),
    db.query<OnboardRow>('SELECT step, created_at FROM onboarding_log WHERE tenant_id = $1 ORDER BY created_at', [tenant.id]),
  ]);

  res.json({
    tenant: { ...tenant, billing_api_key: tenant.billing_api_key ? '***configurado***' : null },
    usage,
    users,
    stats: stats[0],
    onboarding,
  });
}

// ─── PATCH /api/superadmin/tenants/:id ───────────────────────────────────────

const UPDATABLE_FIELDS: ReadonlyArray<keyof TenantRow> = [
  'name', 'nit', 'owner_name', 'phone', 'email', 'address', 'city',
  'opening_time', 'closing_time', 'bays_count', 'plan', 'is_active',
  'trial_ends_at', 'whatsapp_enabled', 'billing_provider',
];

export async function updateTenant(req: Request, res: Response): Promise<void> {
  const body = req.body as Partial<Record<keyof TenantRow, unknown>>;
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const field of UPDATABLE_FIELDS) {
    if (body[field] !== undefined) {
      updates.push(`${field} = $${idx}`);
      values.push(body[field]);
      idx++;
    }
  }

  if (updates.length === 0) throw new AppError('No hay campos para actualizar', 400);

  values.push(req.params.id);
  const { rows } = await db.query<TenantRow>(
    `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values as (string | number | boolean | null)[],
  );

  if (rows.length === 0) throw new AppError('Tenant no encontrado', 404);
  res.json(rows[0]);
}

// ─── PATCH /api/superadmin/tenants/:id/plan ───────────────────────────────────

export async function changePlan(req: Request, res: Response): Promise<void> {
  const { plan } = req.body as { plan?: string };
  if (!plan) throw new AppError('El plan es requerido', 400);

  const { rows: planRows } = await db.query<PlanRow>('SELECT * FROM plans WHERE id = $1 AND is_active = true', [plan]);
  if (planRows.length === 0) throw new AppError('Plan no encontrado', 404);

  const { rows } = await db.query<Pick<TenantRow, 'id' | 'name' | 'plan'>>(
    'UPDATE tenants SET plan = $1 WHERE id = $2 RETURNING id, name, plan',
    [plan, req.params.id],
  );
  if (rows.length === 0) throw new AppError('Tenant no encontrado', 404);

  res.json({ message: `Plan cambiado a "${planRows[0].name}"`, tenant: rows[0], planDetails: planRows[0] });
}

// ─── PATCH /api/superadmin/tenants/:id/toggle ─────────────────────────────────

export async function toggleTenant(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<Pick<TenantRow, 'id' | 'name' | 'is_active'>>(
    'UPDATE tenants SET is_active = NOT is_active WHERE id = $1 RETURNING id, name, is_active',
    [req.params.id],
  );
  if (rows.length === 0) throw new AppError('Tenant no encontrado', 404);
  res.json({ message: rows[0].is_active ? 'Tenant activado' : 'Tenant desactivado', tenant: rows[0] });
}

// ─── GET /api/superadmin/dashboard ───────────────────────────────────────────

export async function dashboard(req: Request, res: Response): Promise<void> {
  type GlobalRow = {
    active_tenants: string; inactive_tenants: string; in_trial: string;
    plan_free: string; plan_basic: string; plan_pro: string;
    total_users: string; today_appointments: string; month_appointments: string;
    month_revenue: string; new_tenants_week: string; new_tenants_month: string;
  };
  type TopRow = { id: string; name: string; slug: string; plan: PlanId; appointments: string; revenue: string };

  const [{ rows }, { rows: topTenants }] = await Promise.all([
    db.query<GlobalRow>(`SELECT
      (SELECT COUNT(*) FROM tenants WHERE is_active = true) AS active_tenants,
      (SELECT COUNT(*) FROM tenants WHERE is_active = false) AS inactive_tenants,
      (SELECT COUNT(*) FROM tenants WHERE trial_ends_at > NOW()) AS in_trial,
      (SELECT COUNT(*) FROM tenants WHERE plan = 'free') AS plan_free,
      (SELECT COUNT(*) FROM tenants WHERE plan = 'basic') AS plan_basic,
      (SELECT COUNT(*) FROM tenants WHERE plan = 'pro') AS plan_pro,
      (SELECT COUNT(*) FROM users WHERE is_active = true) AS total_users,
      (SELECT COUNT(*) FROM appointments WHERE scheduled_date = CURRENT_DATE) AS today_appointments,
      (SELECT COUNT(*) FROM appointments WHERE scheduled_date >= DATE_TRUNC('month', NOW())) AS month_appointments,
      (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE created_at >= DATE_TRUNC('month', NOW())) AS month_revenue,
      (SELECT COUNT(*) FROM tenants WHERE created_at >= NOW() - INTERVAL '7 days') AS new_tenants_week,
      (SELECT COUNT(*) FROM tenants WHERE created_at >= NOW() - INTERVAL '30 days') AS new_tenants_month`),
    db.query<TopRow>(`
      SELECT t.id, t.name, t.slug, t.plan,
             COUNT(a.id) AS appointments, COALESCE(SUM(p.amount), 0) AS revenue
      FROM tenants t
      LEFT JOIN appointments a ON a.tenant_id = t.id AND a.scheduled_date >= DATE_TRUNC('month', NOW())
      LEFT JOIN payments p ON p.appointment_id = a.id
      WHERE t.is_active = true
      GROUP BY t.id, t.name, t.slug, t.plan
      ORDER BY revenue DESC LIMIT 5`),
  ]);

  const r = rows[0];
  const response: SuperAdminDashboardDto = {
    overview: {
      activeTenants:     parseInt(r.active_tenants, 10),
      inactiveTenants:   parseInt(r.inactive_tenants, 10),
      inTrial:           parseInt(r.in_trial, 10),
      totalUsers:        parseInt(r.total_users, 10),
      todayAppointments: parseInt(r.today_appointments, 10),
      monthAppointments: parseInt(r.month_appointments, 10),
      monthRevenue:      parseInt(r.month_revenue, 10),
      newTenantsWeek:    parseInt(r.new_tenants_week, 10),
      newTenantsMonth:   parseInt(r.new_tenants_month, 10),
    },
    planDistribution: {
      free:  parseInt(r.plan_free, 10),
      basic: parseInt(r.plan_basic, 10),
      pro:   parseInt(r.plan_pro, 10),
    },
    topTenants: topTenants.map((t) => ({
      id: t.id, name: t.name, slug: t.slug, plan: t.plan,
      appointments: parseInt(t.appointments, 10),
      revenue:      parseInt(t.revenue, 10),
    })),
  };

  res.json(response);
}

// ─── GET /api/superadmin/plans ────────────────────────────────────────────────

export async function listPlans(req: Request, res: Response): Promise<void> {
  const [{ rows }, { rows: counts }] = await Promise.all([
    db.query<PlanRow>('SELECT * FROM plans ORDER BY sort_order'),
    db.query<{ plan: string; count: string }>('SELECT plan, COUNT(*) AS count FROM tenants WHERE is_active = true GROUP BY plan'),
  ]);

  const countMap = Object.fromEntries(counts.map((c) => [c.plan, parseInt(c.count, 10)]));
  res.json(rows.map((p) => ({ ...p, tenantCount: countMap[p.id] ?? 0 })));
}

// ─── PUT /api/superadmin/plans/:id ────────────────────────────────────────────

export async function updatePlan(req: Request, res: Response): Promise<void> {
  const body = req.body as Partial<{
    name: string; priceMonthly: number; maxOperators: number;
    maxAppointmentsMonth: number; maxServices: number; maxBays: number;
    whatsappEnabled: boolean; billingEnabled: boolean; reportsEnabled: boolean;
  }>;

  const fieldMap: Record<string, keyof PlanRow> = {
    name: 'name', priceMonthly: 'price_monthly', maxOperators: 'max_operators',
    maxAppointmentsMonth: 'max_appointments_month', maxServices: 'max_services', maxBays: 'max_bays',
    whatsappEnabled: 'whatsapp_enabled', billingEnabled: 'billing_enabled', reportsEnabled: 'reports_enabled',
  };

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
    const val = body[jsKey as keyof typeof body];
    if (val !== undefined) {
      updates.push(`${dbKey} = $${idx}`);
      values.push(val);
      idx++;
    }
  }

  if (updates.length === 0) throw new AppError('No hay campos', 400);

  values.push(req.params.id);
  const { rows } = await db.query<PlanRow>(
    `UPDATE plans SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values as (string | number | boolean | null)[],
  );
  if (rows.length === 0) throw new AppError('Plan no encontrado', 404);
  res.json(rows[0]);
}