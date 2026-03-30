const db = require("../../shared/db");
const { AppError } = require("../../shared/middleware/errorHandler");
const { getTenantUsage } = require("../../shared/middleware/planLimits");
const { getTenantToday } = require("../../shared/utils/dateUtils");

// ---------------------------------------------------------------------------
// GET /api/tenants/me
// ---------------------------------------------------------------------------
async function getCurrent(req, res) {
  const { rows } = await db.query(
    `SELECT id, name, slug, nit, owner_name, phone, email, address, city,
            timezone, opening_time, closing_time, bays_count, currency, plan,
            whatsapp_enabled, whatsapp_phone,
            created_at
     FROM tenants
     WHERE id = $1`,
    [req.tenantId],
  );

  if (rows.length === 0) {
    throw new AppError("Lavadero no encontrado", 404);
  }

  res.json(rows[0]);
}

// ---------------------------------------------------------------------------
// PATCH /api/tenants/me
// ---------------------------------------------------------------------------
async function updateCurrent(req, res) {
  // Solo campos editables (no plan, no id, no slug)
  const allowedFields = [
    "name",
    "nit",
    "owner_name",
    "phone",
    "email",
    "address",
    "city",
    "opening_time",
    "closing_time",
    "bays_count",
  ];

  const updates = [];
  const values = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = $${paramIndex}`);
      values.push(req.body[field]);
      paramIndex++;
    }
  }

  if (updates.length === 0) {
    throw new AppError("No hay campos para actualizar", 400);
  }

  values.push(req.tenantId);

  const { rows } = await db.query(
    `UPDATE tenants SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );

  res.json(rows[0]);
}

// ---------------------------------------------------------------------------
// GET /api/tenants/me/stats - Resumen del día
// ---------------------------------------------------------------------------
async function getDayStats(req, res) {
  const todayDate = await getTenantToday(req.tenantId);

  const { rows } = await db.query(
    `SELECT
       COUNT(*) AS total_appointments,
       COUNT(*) FILTER (WHERE status = 'pending') AS pending,
       COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
       COUNT(*) FILTER (WHERE status = 'done') AS done,
       COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
     FROM appointments
     WHERE tenant_id = $1 AND scheduled_date = $2`,
    [req.tenantId, today],
  );

  const { rows: revenueRows } = await db.query(
    `SELECT COALESCE(SUM(p.amount), 0) AS total_revenue,
            COUNT(p.id) AS total_payments
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     WHERE a.tenant_id = $1 AND a.scheduled_date = $2`,
    [req.tenantId, today],
  );

  res.json({
    date: today,
    appointments: rows[0],
    revenue: {
      total: parseInt(revenueRows[0].total_revenue),
      payments: parseInt(revenueRows[0].total_payments),
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/tenants/me/operators - Lista de operadores del lavadero
// ---------------------------------------------------------------------------
async function getOperators(req, res) {
  const { rows } = await db.query(
    `SELECT id, first_name, last_name, phone, role, is_active
     FROM users
     WHERE tenant_id = $1 AND is_active = true
     ORDER BY first_name`,
    [req.tenantId],
  );
  res.json(rows);
}

async function getUsage(req, res) {
  const usage = await getTenantUsage(req.tenantId);
  res.json(usage);
}

module.exports = { getCurrent, updateCurrent, getDayStats, getOperators };
