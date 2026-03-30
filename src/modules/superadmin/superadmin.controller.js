/**
 * Super Admin Controller
 * 
 * Solo accesible por usuarios con role='super_admin' y tenant_id=NULL.
 * Gestiona todos los tenants del SaaS.
 * 
 * Endpoints:
 *   GET    /api/superadmin/tenants          — Lista todos los tenants
 *   GET    /api/superadmin/tenants/:id      — Detalle de un tenant
 *   PATCH  /api/superadmin/tenants/:id      — Editar tenant (plan, estado, etc.)
 *   PATCH  /api/superadmin/tenants/:id/plan — Cambiar plan de un tenant
 *   PATCH  /api/superadmin/tenants/:id/toggle — Activar/desactivar tenant
 *   GET    /api/superadmin/dashboard        — Métricas globales del SaaS
 *   GET    /api/superadmin/plans            — Lista de planes disponibles
 *   POST   /api/superadmin/plans            — Crear/editar plan
 */

const db = require('../../shared/db');
const { AppError } = require('../../shared/middleware/errorHandler');
const { getTenantUsage } = require('../../shared/middleware/planLimits');

// ─────────────────────────────────────────────────────────────────────────
// GET /api/superadmin/tenants?page=1&search=&plan=&status=active
// ─────────────────────────────────────────────────────────────────────────
async function listTenants(req, res) {
  const { page = 1, limit = 20, search, plan, status } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [];
  const conditions = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(t.name ILIKE $${params.length} OR t.slug ILIKE $${params.length} OR t.email ILIKE $${params.length} OR t.nit ILIKE $${params.length})`);
  }
  if (plan) {
    params.push(plan);
    conditions.push(`t.plan = $${params.length}`);
  }
  if (status === 'active') conditions.push('t.is_active = true');
  if (status === 'inactive') conditions.push('t.is_active = false');

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) FROM tenants t ${where}`, params
  );

  params.push(parseInt(limit), offset);
  const { rows } = await db.query(
    `SELECT t.*,
            (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.is_active = true) as user_count,
            (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id = t.id AND a.scheduled_date = CURRENT_DATE) as today_appointments,
            (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.tenant_id = t.id AND p.created_at >= DATE_TRUNC('month', NOW())) as month_revenue
     FROM tenants t
     ${where}
     ORDER BY t.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    data: rows.map(t => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      nit: t.nit,
      ownerName: t.owner_name,
      phone: t.phone,
      email: t.email,
      city: t.city,
      plan: t.plan,
      isActive: t.is_active,
      trialEndsAt: t.trial_ends_at,
      whatsappEnabled: t.whatsapp_enabled,
      billingProvider: t.billing_provider,
      userCount: parseInt(t.user_count),
      todayAppointments: parseInt(t.today_appointments),
      monthRevenue: parseInt(t.month_revenue),
      createdAt: t.created_at,
    })),
    pagination: {
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/superadmin/tenants/:id
// ─────────────────────────────────────────────────────────────────────────
async function getTenantDetail(req, res) {
  const { rows } = await db.query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
  if (rows.length === 0) throw new AppError('Tenant no encontrado', 404);

  const tenant = rows[0];
  const usage = await getTenantUsage(tenant.id);

  // Usuarios del tenant
  const { rows: users } = await db.query(
    'SELECT id, email, first_name, last_name, role, is_active, last_login_at FROM users WHERE tenant_id = $1 ORDER BY role, first_name',
    [tenant.id]
  );

  // Estadísticas generales
  const { rows: stats } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM customers WHERE tenant_id = $1 AND deleted_at IS NULL) as customers,
      (SELECT COUNT(*) FROM vehicles WHERE tenant_id = $1 AND deleted_at IS NULL) as vehicles,
      (SELECT COUNT(*) FROM appointments WHERE tenant_id = $1) as total_appointments,
      (SELECT COUNT(*) FROM payments WHERE tenant_id = $1) as total_payments,
      (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE tenant_id = $1) as total_revenue
  `, [tenant.id]);

  // Onboarding
  const { rows: onboarding } = await db.query(
    'SELECT step, created_at FROM onboarding_log WHERE tenant_id = $1 ORDER BY created_at',
    [tenant.id]
  );

  res.json({
    tenant: {
      ...tenant,
      billing_api_key: tenant.billing_api_key ? '***configurado***' : null, // No exponer credenciales
    },
    usage,
    users,
    stats: stats[0],
    onboarding,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/superadmin/tenants/:id
// ─────────────────────────────────────────────────────────────────────────
async function updateTenant(req, res) {
  const allowed = [
    'name', 'nit', 'owner_name', 'phone', 'email', 'address', 'city',
    'opening_time', 'closing_time', 'bays_count', 'plan', 'is_active',
    'trial_ends_at', 'whatsapp_enabled', 'billing_provider',
  ];

  const updates = [];
  const values = [];
  let idx = 1;

  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = $${idx}`);
      values.push(req.body[field]);
      idx++;
    }
  }

  if (updates.length === 0) throw new AppError('No hay campos para actualizar', 400);

  values.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  if (rows.length === 0) throw new AppError('Tenant no encontrado', 404);
  res.json(rows[0]);
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/superadmin/tenants/:id/plan
// ─────────────────────────────────────────────────────────────────────────
async function changePlan(req, res) {
  const { plan } = req.body;

  if (!plan) throw new AppError('El plan es requerido', 400);

  // Verificar que el plan existe
  const { rows: planRows } = await db.query('SELECT * FROM plans WHERE id = $1 AND is_active = true', [plan]);
  if (planRows.length === 0) throw new AppError('Plan no encontrado', 404);

  const { rows } = await db.query(
    'UPDATE tenants SET plan = $1 WHERE id = $2 RETURNING id, name, plan',
    [plan, req.params.id]
  );

  if (rows.length === 0) throw new AppError('Tenant no encontrado', 404);

  res.json({
    message: `Plan cambiado a "${planRows[0].name}"`,
    tenant: rows[0],
    planDetails: planRows[0],
  });
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/superadmin/tenants/:id/toggle
// ─────────────────────────────────────────────────────────────────────────
async function toggleTenant(req, res) {
  const { rows } = await db.query(
    'UPDATE tenants SET is_active = NOT is_active WHERE id = $1 RETURNING id, name, is_active',
    [req.params.id]
  );
  if (rows.length === 0) throw new AppError('Tenant no encontrado', 404);

  res.json({
    message: rows[0].is_active ? 'Tenant activado' : 'Tenant desactivado',
    tenant: rows[0],
  });
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/superadmin/dashboard
// Métricas globales del SaaS.
// ─────────────────────────────────────────────────────────────────────────
async function dashboard(req, res) {
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM tenants WHERE is_active = true) as active_tenants,
      (SELECT COUNT(*) FROM tenants WHERE is_active = false) as inactive_tenants,
      (SELECT COUNT(*) FROM tenants WHERE trial_ends_at > NOW()) as in_trial,
      (SELECT COUNT(*) FROM tenants WHERE plan = 'free') as plan_free,
      (SELECT COUNT(*) FROM tenants WHERE plan = 'basic') as plan_basic,
      (SELECT COUNT(*) FROM tenants WHERE plan = 'pro') as plan_pro,
      (SELECT COUNT(*) FROM users WHERE is_active = true) as total_users,
      (SELECT COUNT(*) FROM appointments WHERE scheduled_date = CURRENT_DATE) as today_appointments,
      (SELECT COUNT(*) FROM appointments WHERE scheduled_date >= DATE_TRUNC('month', NOW())) as month_appointments,
      (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE created_at >= DATE_TRUNC('month', NOW())) as month_revenue,
      (SELECT COUNT(*) FROM tenants WHERE created_at >= NOW() - INTERVAL '7 days') as new_tenants_week,
      (SELECT COUNT(*) FROM tenants WHERE created_at >= NOW() - INTERVAL '30 days') as new_tenants_month
  `);

  // Top 5 tenants por ingresos este mes
  const { rows: topTenants } = await db.query(`
    SELECT t.id, t.name, t.slug, t.plan,
           COUNT(a.id) as appointments,
           COALESCE(SUM(p.amount), 0) as revenue
    FROM tenants t
    LEFT JOIN appointments a ON a.tenant_id = t.id AND a.scheduled_date >= DATE_TRUNC('month', NOW())
    LEFT JOIN payments p ON p.appointment_id = a.id
    WHERE t.is_active = true
    GROUP BY t.id, t.name, t.slug, t.plan
    ORDER BY revenue DESC
    LIMIT 5
  `);

  res.json({
    overview: {
      activeTenants: parseInt(rows[0].active_tenants),
      inactiveTenants: parseInt(rows[0].inactive_tenants),
      inTrial: parseInt(rows[0].in_trial),
      totalUsers: parseInt(rows[0].total_users),
      todayAppointments: parseInt(rows[0].today_appointments),
      monthAppointments: parseInt(rows[0].month_appointments),
      monthRevenue: parseInt(rows[0].month_revenue),
      newTenantsWeek: parseInt(rows[0].new_tenants_week),
      newTenantsMonth: parseInt(rows[0].new_tenants_month),
    },
    planDistribution: {
      free: parseInt(rows[0].plan_free),
      basic: parseInt(rows[0].plan_basic),
      pro: parseInt(rows[0].plan_pro),
    },
    topTenants: topTenants.map(t => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      plan: t.plan,
      appointments: parseInt(t.appointments),
      revenue: parseInt(t.revenue),
    })),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/superadmin/plans
// ─────────────────────────────────────────────────────────────────────────
async function listPlans(req, res) {
  const { rows } = await db.query('SELECT * FROM plans ORDER BY sort_order');

  // Contar tenants por plan
  const { rows: counts } = await db.query(
    `SELECT plan, COUNT(*) as count FROM tenants WHERE is_active = true GROUP BY plan`
  );
  const countMap = {};
  counts.forEach(c => { countMap[c.plan] = parseInt(c.count); });

  res.json(rows.map(p => ({
    ...p,
    tenantCount: countMap[p.id] || 0,
  })));
}

// ─────────────────────────────────────────────────────────────────────────
// PUT /api/superadmin/plans/:id
// ─────────────────────────────────────────────────────────────────────────
async function updatePlan(req, res) {
  const { name, priceMonthly, maxOperators, maxAppointmentsMonth, maxServices, maxBays,
          whatsappEnabled, billingEnabled, reportsEnabled } = req.body;

  const updates = [];
  const values = [];
  let idx = 1;
  const fields = { name, price_monthly: priceMonthly, max_operators: maxOperators,
    max_appointments_month: maxAppointmentsMonth, max_services: maxServices, max_bays: maxBays,
    whatsapp_enabled: whatsappEnabled, billing_enabled: billingEnabled, reports_enabled: reportsEnabled };

  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) {
      updates.push(`${k} = $${idx}`);
      values.push(v);
      idx++;
    }
  }

  if (updates.length === 0) throw new AppError('No hay campos', 400);

  values.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE plans SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (rows.length === 0) throw new AppError('Plan no encontrado', 404);
  res.json(rows[0]);
}

module.exports = { listTenants, getTenantDetail, updateTenant, changePlan, toggleTenant, dashboard, listPlans, updatePlan };
