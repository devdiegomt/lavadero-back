const db = require('../../shared/db');
const { getTenantToday } = require('../../shared/utils/dateUtils');

async function getDateRange(tenantId, period, from, to) {
  const todayDate = await getTenantToday(tenantId);
  if (period === 'today') return { from: todayDate, to: todayDate };
  if (period === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 6);
    return { from: d.toISOString().split('T')[0], to: todayDate };
  }
  if (period === 'month') {
    const d = new Date(); d.setDate(d.getDate() - 29);
    return { from: d.toISOString().split('T')[0], to: todayDate };
  }
  if (from && to) return { from, to };
  // Default: last 7 days
  const d = new Date(); d.setDate(d.getDate() - 6);
  return { from: d.toISOString().split('T')[0], to: todayDate };
}

// GET /api/reports/dashboard
async function dashboard(req, res) {
  const { from, to } = getDateRange(req.tenantId, req.query.period, req.query.from, req.query.to);

  const { rows } = await db.query(
    `SELECT
       COUNT(*) as total_appointments,
       COUNT(*) FILTER (WHERE a.status = 'delivered') as completed,
       COUNT(*) FILTER (WHERE a.status = 'cancelled') as cancelled,
       COUNT(DISTINCT a.customer_id) as unique_customers,
       COUNT(DISTINCT a.vehicle_id) as unique_vehicles,
       COALESCE(SUM(p.amount), 0) as total_revenue,
       COUNT(p.id) as total_payments,
       AVG(EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) / 60)
         FILTER (WHERE a.completed_at IS NOT NULL AND a.started_at IS NOT NULL) as avg_service_minutes,
       AVG(p.amount) FILTER (WHERE p.amount > 0) as avg_ticket
     FROM appointments a
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3`,
    [req.tenantId, from, to]
  );

  // Comparison with previous period
  const rangeDays = Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1;
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - rangeDays + 1);

  const { rows: prevRows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE a.status = 'delivered') as completed,
       COALESCE(SUM(p.amount), 0) as total_revenue
     FROM appointments a
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3`,
    [req.tenantId, prevFrom.toISOString().split('T')[0], prevTo.toISOString().split('T')[0]]
  );

  const r = rows[0];
  const prev = prevRows[0];

  const revenueChange = parseInt(prev.total_revenue) > 0
    ? ((parseInt(r.total_revenue) - parseInt(prev.total_revenue)) / parseInt(prev.total_revenue) * 100)
    : null;
  const appointmentChange = parseInt(prev.completed) > 0
    ? ((parseInt(r.completed) - parseInt(prev.completed)) / parseInt(prev.completed) * 100)
    : null;

  res.json({
    period: { from, to },
    summary: {
      total_appointments: parseInt(r.total_appointments),
      completed: parseInt(r.completed),
      cancelled: parseInt(r.cancelled),
      unique_customers: parseInt(r.unique_customers),
      unique_vehicles: parseInt(r.unique_vehicles),
      total_revenue: parseInt(r.total_revenue),
      total_payments: parseInt(r.total_payments),
      avg_service_minutes: r.avg_service_minutes ? Math.round(parseFloat(r.avg_service_minutes)) : null,
      avg_ticket: r.avg_ticket ? parseInt(r.avg_ticket) : 0,
    },
    comparison: {
      revenue_change_pct: revenueChange !== null ? Math.round(revenueChange) : null,
      appointment_change_pct: appointmentChange !== null ? Math.round(appointmentChange) : null,
    },
  });
}

// GET /api/reports/revenue
async function revenue(req, res) {
  const { from, to } = getDateRange(req.tenantId, req.query.period, req.query.from, req.query.to);

  // Daily revenue
  const { rows: daily } = await db.query(
    `SELECT a.scheduled_date as date,
            COUNT(*) FILTER (WHERE a.status = 'delivered') as completed,
            COUNT(*) as total,
            COALESCE(SUM(p.amount), 0) as revenue
     FROM appointments a
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3
     GROUP BY a.scheduled_date
     ORDER BY a.scheduled_date`,
    [req.tenantId, from, to]
  );

  // By payment method
  const { rows: byMethod } = await db.query(
    `SELECT p.payment_method, COUNT(*) as count, SUM(p.amount) as total
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3
     GROUP BY p.payment_method ORDER BY total DESC`,
    [req.tenantId, from, to]
  );

  // By hour of day
  const { rows: byHour } = await db.query(
    `SELECT EXTRACT(HOUR FROM a.scheduled_time) as hour, COUNT(*) as count
     FROM appointments a
     WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3
       AND a.scheduled_time IS NOT NULL AND a.status != 'cancelled'
     GROUP BY hour ORDER BY hour`,
    [req.tenantId, from, to]
  );

  res.json({
    period: { from, to },
    daily: daily.map(r => ({
      date: r.date,
      completed: parseInt(r.completed),
      total: parseInt(r.total),
      revenue: parseInt(r.revenue),
    })),
    byMethod: byMethod.map(r => ({
      method: r.payment_method,
      count: parseInt(r.count),
      total: parseInt(r.total),
    })),
    byHour: byHour.map(r => ({
      hour: parseInt(r.hour),
      count: parseInt(r.count),
    })),
  });
}

// GET /api/reports/services
async function topServices(req, res) {
  const { from, to } = getDateRange(req.tenantId, req.query.period, req.query.from, req.query.to);

  const { rows } = await db.query(
    `SELECT s.name, COUNT(*) as count,
            COALESCE(SUM(p.amount), 0) as revenue,
            AVG(EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) / 60)
              FILTER (WHERE a.completed_at IS NOT NULL AND a.started_at IS NOT NULL) as avg_minutes
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3 AND a.status != 'cancelled'
     GROUP BY s.name ORDER BY count DESC`,
    [req.tenantId, from, to]
  );

  res.json({
    period: { from, to },
    services: rows.map(r => ({
      name: r.name,
      count: parseInt(r.count),
      revenue: parseInt(r.revenue),
      avg_minutes: r.avg_minutes ? Math.round(parseFloat(r.avg_minutes)) : null,
    })),
  });
}

// GET /api/reports/customers
async function topCustomers(req, res) {
  const { from, to } = getDateRange(req.tenantId, req.query.period, req.query.from, req.query.to);

  const { rows } = await db.query(
    `SELECT c.id, c.first_name, c.last_name, c.phone,
            COUNT(a.id) as visit_count,
            COALESCE(SUM(p.amount), 0) as total_spent,
            MAX(a.scheduled_date) as last_visit
     FROM appointments a
     JOIN customers c ON c.id = a.customer_id
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3 AND a.status = 'delivered'
     GROUP BY c.id, c.first_name, c.last_name, c.phone
     ORDER BY total_spent DESC
     LIMIT 10`,
    [req.tenantId, from, to]
  );

  res.json({
    period: { from, to },
    customers: rows.map(r => ({
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      phone: r.phone,
      visit_count: parseInt(r.visit_count),
      total_spent: parseInt(r.total_spent),
      last_visit: r.last_visit,
    })),
  });
}

// GET /api/reports/operators
async function operators(req, res) {
  const { from, to } = getDateRange(req.tenantId, req.query.period, req.query.from, req.query.to);

  const { rows } = await db.query(
    `SELECT u.id, u.first_name, u.last_name,
            COUNT(a.id) as total_appointments,
            COUNT(a.id) FILTER (WHERE a.status = 'delivered') as completed,
            COALESCE(SUM(p.amount), 0) as revenue_generated,
            AVG(EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) / 60)
              FILTER (WHERE a.completed_at IS NOT NULL AND a.started_at IS NOT NULL) as avg_minutes
     FROM users u
     LEFT JOIN appointments a ON a.assigned_to = u.id
       AND a.scheduled_date BETWEEN $2 AND $3
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE u.tenant_id = $1 AND u.role = 'operator' AND u.is_active = true
     GROUP BY u.id, u.first_name, u.last_name
     ORDER BY completed DESC`,
    [req.tenantId, from, to]
  );

  res.json({
    period: { from, to },
    operators: rows.map(r => ({
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      total: parseInt(r.total_appointments),
      completed: parseInt(r.completed),
      revenue: parseInt(r.revenue_generated),
      avg_minutes: r.avg_minutes ? Math.round(parseFloat(r.avg_minutes)) : null,
    })),
  });
}

module.exports = { dashboard, revenue, topServices, topCustomers, operators };
