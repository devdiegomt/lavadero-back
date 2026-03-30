const db = require('../../shared/db');
const { AppError } = require('../../shared/middleware/errorHandler');

// GET /api/history/vehicle/:plate?from=&to=&page=1&limit=20
async function vehicleHistory(req, res) {
  const { from, to, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Find vehicle
  const { rows: vehicleRows } = await db.query(
    `SELECT v.*, c.first_name as customer_first_name, c.last_name as customer_last_name,
            c.phone as customer_phone, c.email as customer_email, c.id as customer_id
     FROM vehicles v
     JOIN customers c ON c.id = v.customer_id
     WHERE UPPER(v.plate) = UPPER($1) AND v.tenant_id = $2 AND v.deleted_at IS NULL`,
    [req.params.plate.trim(), req.tenantId]
  );

  if (vehicleRows.length === 0) throw new AppError('Vehículo no encontrado', 404);
  const vehicle = vehicleRows[0];

  // Build date filter
  const params = [vehicle.id];
  let dateFilter = '';
  if (from) {
    params.push(from);
    dateFilter += ` AND a.scheduled_date >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    dateFilter += ` AND a.scheduled_date <= $${params.length}`;
  }

  // Stats
  const { rows: statsRows } = await db.query(
    `SELECT
       COUNT(*) as total_visits,
       COUNT(*) FILTER (WHERE a.status = 'delivered') as completed_visits,
       COALESCE(SUM(p.amount), 0) as total_spent,
       MIN(a.scheduled_date) as first_visit,
       MAX(a.scheduled_date) as last_visit,
       AVG(EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) / 60)
         FILTER (WHERE a.completed_at IS NOT NULL AND a.started_at IS NOT NULL) as avg_service_minutes
     FROM appointments a
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.vehicle_id = $1 ${dateFilter}`,
    params
  );

  // Appointments list
  const listParams = [...params, parseInt(limit), offset];
  const { rows: appointments } = await db.query(
    `SELECT a.id, a.scheduled_date, a.scheduled_time, a.status, a.price, a.source, a.notes,
            a.started_at, a.completed_at, a.delivered_at, a.created_at,
            s.name as service_name, s.estimated_minutes,
            u.first_name as operator_first_name, u.last_name as operator_last_name,
            p.amount as paid_amount, p.payment_method, p.created_at as paid_at
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = a.assigned_to
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.vehicle_id = $1 ${dateFilter}
     ORDER BY a.scheduled_date DESC, a.created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const countParams = [...params];
  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) FROM appointments a WHERE a.vehicle_id = $1 ${dateFilter}`,
    countParams
  );

  // Most used service
  const { rows: topService } = await db.query(
    `SELECT s.name, COUNT(*) as count
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     WHERE a.vehicle_id = $1 AND a.status = 'delivered'
     GROUP BY s.name ORDER BY count DESC LIMIT 1`,
    [vehicle.id]
  );

  res.json({
    vehicle: {
      id: vehicle.id,
      plate: vehicle.plate,
      vehicle_type: vehicle.vehicle_type,
      brand: vehicle.brand,
      model: vehicle.model,
      color: vehicle.color,
      year: vehicle.year,
    },
    customer: {
      id: vehicle.customer_id,
      first_name: vehicle.customer_first_name,
      last_name: vehicle.customer_last_name,
      phone: vehicle.customer_phone,
      email: vehicle.customer_email,
    },
    stats: {
      total_visits: parseInt(statsRows[0].total_visits),
      completed_visits: parseInt(statsRows[0].completed_visits),
      total_spent: parseInt(statsRows[0].total_spent),
      first_visit: statsRows[0].first_visit,
      last_visit: statsRows[0].last_visit,
      avg_service_minutes: statsRows[0].avg_service_minutes ? Math.round(parseFloat(statsRows[0].avg_service_minutes)) : null,
      favorite_service: topService[0]?.name || null,
    },
    appointments,
    pagination: {
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
}

// GET /api/history/customer/:id?page=1&limit=20
async function customerHistory(req, res) {
  // Verify customer belongs to tenant
  const { rows: custRows } = await db.query(
    `SELECT c.*, 
       (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id = c.id AND v.deleted_at IS NULL) as vehicle_count
     FROM customers c 
     WHERE c.id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL`,
    [req.params.id, req.tenantId]
  );
  if (custRows.length === 0) throw new AppError('Cliente no encontrado', 404);
  const customer = custRows[0];

  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Customer vehicles
  const { rows: vehicles } = await db.query(
    `SELECT id, plate, vehicle_type, brand, model, color, year
     FROM vehicles WHERE customer_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [req.params.id, req.tenantId]
  );

  // Stats across all vehicles
  const { rows: statsRows } = await db.query(
    `SELECT
       COUNT(*) as total_visits,
       COALESCE(SUM(p.amount), 0) as total_spent,
       MIN(a.scheduled_date) as first_visit,
       MAX(a.scheduled_date) as last_visit
     FROM appointments a
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.customer_id = $1 AND a.tenant_id = $2`,
    [req.params.id, req.tenantId]
  );

  // Appointments across all vehicles
  const { rows: appointments } = await db.query(
    `SELECT a.id, a.scheduled_date, a.scheduled_time, a.status, a.price, a.notes,
            a.started_at, a.completed_at, a.delivered_at,
            v.plate, v.vehicle_type, v.brand, v.model, v.color,
            s.name as service_name,
            p.amount as paid_amount, p.payment_method
     FROM appointments a
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.customer_id = $1 AND a.tenant_id = $2
     ORDER BY a.scheduled_date DESC, a.created_at DESC
     LIMIT $3 OFFSET $4`,
    [req.params.id, req.tenantId, parseInt(limit), offset]
  );

  const { rows: countRows } = await db.query(
    'SELECT COUNT(*) FROM appointments WHERE customer_id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId]
  );

  // Spending by month (last 6 months)
  const { rows: monthlySpend } = await db.query(
    `SELECT DATE_TRUNC('month', a.scheduled_date) as month, COALESCE(SUM(p.amount), 0) as total
     FROM appointments a
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.customer_id = $1 AND a.tenant_id = $2
       AND a.scheduled_date >= NOW() - interval '6 months'
     GROUP BY month ORDER BY month`,
    [req.params.id, req.tenantId]
  );

  res.json({
    customer: {
      id: customer.id,
      first_name: customer.first_name,
      last_name: customer.last_name,
      phone: customer.phone,
      email: customer.email,
      document_type: customer.document_type,
      document_number: customer.document_number,
      notes: customer.notes,
      created_at: customer.created_at,
    },
    vehicles,
    stats: {
      total_visits: parseInt(statsRows[0].total_visits),
      total_spent: parseInt(statsRows[0].total_spent),
      first_visit: statsRows[0].first_visit,
      last_visit: statsRows[0].last_visit,
      vehicle_count: parseInt(customer.vehicle_count),
    },
    monthlySpend: monthlySpend.map(r => ({ month: r.month, total: parseInt(r.total) })),
    appointments,
    pagination: {
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
}

// GET /api/history/search?q=ABC123
async function search(req, res) {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json({ vehicles: [], customers: [] });
  }

  const term = `%${q.trim()}%`;

  // Search vehicles
  const { rows: vehicles } = await db.query(
    `SELECT v.id, v.plate, v.vehicle_type, v.brand, v.model, v.color,
            c.first_name as customer_first_name, c.last_name as customer_last_name, c.phone as customer_phone
     FROM vehicles v
     JOIN customers c ON c.id = v.customer_id
     WHERE v.tenant_id = $1 AND v.deleted_at IS NULL
       AND (UPPER(v.plate) ILIKE UPPER($2) OR v.brand ILIKE $2 OR v.model ILIKE $2)
     ORDER BY v.plate
     LIMIT 5`,
    [req.tenantId, term]
  );

  // Search customers
  const { rows: customers } = await db.query(
    `SELECT c.id, c.first_name, c.last_name, c.phone, c.email, c.visit_count,
            (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id = c.id AND v.deleted_at IS NULL) as vehicle_count
     FROM customers c
     WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
       AND (c.first_name ILIKE $2 OR c.last_name ILIKE $2 OR c.phone ILIKE $2 OR c.document_number ILIKE $2)
     ORDER BY c.visit_count DESC
     LIMIT 5`,
    [req.tenantId, term]
  );

  res.json({ vehicles, customers });
}

module.exports = { vehicleHistory, customerHistory, search };
