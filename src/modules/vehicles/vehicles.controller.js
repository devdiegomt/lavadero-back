const db = require('../../shared/db');
const { AppError } = require('../../shared/middleware/errorHandler');

// GET /api/vehicles?search=ABC&page=1&limit=20
async function list(req, res) {
  const { search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [req.tenantId];
  let where = 'v.tenant_id = $1 AND v.deleted_at IS NULL';

  if (search) {
    params.push(`%${search.toUpperCase()}%`);
    where += ` AND (UPPER(v.plate) ILIKE $${params.length} OR v.brand ILIKE $${params.length} OR v.model ILIKE $${params.length})`;
  }

  const countResult = await db.query(`SELECT COUNT(*) FROM vehicles v WHERE ${where}`, params);

  params.push(parseInt(limit), offset);
  const { rows } = await db.query(
    `SELECT v.*, c.first_name as customer_first_name, c.last_name as customer_last_name, c.phone as customer_phone
     FROM vehicles v
     JOIN customers c ON c.id = v.customer_id
     WHERE ${where}
     ORDER BY v.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    data: rows,
    pagination: {
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
}

// GET /api/vehicles/plate/:plate  (la query más frecuente del sistema)
async function getByPlate(req, res) {
  const { rows } = await db.query(
    `SELECT v.*, c.id as customer_id, c.first_name as customer_first_name,
            c.last_name as customer_last_name, c.phone as customer_phone, c.email as customer_email
     FROM vehicles v
     JOIN customers c ON c.id = v.customer_id
     WHERE UPPER(v.plate) = UPPER($1) AND v.tenant_id = $2 AND v.deleted_at IS NULL
     LIMIT 1`,
    [req.params.plate.trim(), req.tenantId]
  );

  if (rows.length === 0) throw new AppError('Vehículo no encontrado', 404);
  res.json(rows[0]);
}

// GET /api/vehicles/:id
async function getById(req, res) {
  const { rows } = await db.query(
    `SELECT v.*, c.first_name as customer_first_name, c.last_name as customer_last_name, c.phone as customer_phone
     FROM vehicles v
     JOIN customers c ON c.id = v.customer_id
     WHERE v.id = $1 AND v.tenant_id = $2 AND v.deleted_at IS NULL`,
    [req.params.id, req.tenantId]
  );

  if (rows.length === 0) throw new AppError('Vehículo no encontrado', 404);
  res.json(rows[0]);
}

// POST /api/vehicles
async function create(req, res) {
  const { customerId, plate, vehicleType, brand, model, color, year, notes } = req.body;

  if (!customerId || !plate) {
    throw new AppError('Cliente y placa son requeridos', 400);
  }

  // Verificar que el cliente pertenece al tenant
  const { rows: customerRows } = await db.query(
    'SELECT id FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [customerId, req.tenantId]
  );
  if (customerRows.length === 0) throw new AppError('Cliente no encontrado', 404);

  const { rows } = await db.query(
    `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type, brand, model, color, year, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [req.tenantId, customerId, plate.toUpperCase().trim(), vehicleType || 'sedan',
     brand?.trim() || null, model?.trim() || null, color?.trim() || null,
     year || null, notes?.trim() || null]
  );

  res.status(201).json(rows[0]);
}

// PATCH /api/vehicles/:id
async function update(req, res) {
  const fieldMap = {
    plate: 'plate', vehicleType: 'vehicle_type', brand: 'brand',
    model: 'model', color: 'color', year: 'year', notes: 'notes',
  };

  const updates = [];
  const values = [];
  let idx = 1;

  for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
    if (req.body[jsKey] !== undefined) {
      let val = req.body[jsKey];
      if (dbKey === 'plate') val = val.toUpperCase().trim();
      updates.push(`${dbKey} = $${idx}`);
      values.push(val);
      idx++;
    }
  }

  if (updates.length === 0) throw new AppError('No hay campos para actualizar', 400);

  values.push(req.params.id, req.tenantId);
  const { rows } = await db.query(
    `UPDATE vehicles SET ${updates.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
     RETURNING *`,
    values
  );

  if (rows.length === 0) throw new AppError('Vehículo no encontrado', 404);
  res.json(rows[0]);
}

// DELETE /api/vehicles/:id
async function remove(req, res) {
  const { rows } = await db.query(
    `UPDATE vehicles SET deleted_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
    [req.params.id, req.tenantId]
  );
  if (rows.length === 0) throw new AppError('Vehículo no encontrado', 404);
  res.json({ message: 'Vehículo eliminado' });
}


// GET /api/vehicles/:id/history?page=1&limit=20
async function getHistory(req, res) {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Verify vehicle belongs to tenant
  const { rows: vRows } = await db.query(
    'SELECT id FROM vehicles WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [req.params.id, req.tenantId]
  );
  if (vRows.length === 0) throw new AppError('Vehículo no encontrado', 404);

  const countResult = await db.query(
    'SELECT COUNT(*) FROM appointments WHERE vehicle_id = $1',
    [req.params.id]
  );

  const { rows } = await db.query(
    `SELECT a.id, a.scheduled_date, a.scheduled_time, a.status, a.price, a.source, a.notes,
            a.started_at, a.completed_at, a.delivered_at, a.created_at,
            s.name as service_name, s.estimated_minutes,
            u.first_name as operator_first_name, u.last_name as operator_last_name,
            p.amount as payment_amount, p.payment_method,
            EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) / 60 as actual_minutes
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = a.assigned_to
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.vehicle_id = $1
     ORDER BY a.scheduled_date DESC, a.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.params.id, parseInt(limit), offset]
  );

  // Stats summary
  const { rows: stats } = await db.query(
    `SELECT
       COUNT(*) as total_visits,
       COUNT(*) FILTER (WHERE status = 'delivered') as completed_visits,
       COALESCE(SUM(p.amount), 0) as total_spent,
       MIN(a.scheduled_date) as first_visit,
       MAX(a.scheduled_date) as last_visit,
       AVG(EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) / 60)
         FILTER (WHERE a.completed_at IS NOT NULL AND a.started_at IS NOT NULL) as avg_minutes
     FROM appointments a
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.vehicle_id = $1`,
    [req.params.id]
  );

  res.json({
    data: rows,
    stats: {
      totalVisits: parseInt(stats[0].total_visits),
      completedVisits: parseInt(stats[0].completed_visits),
      totalSpent: parseInt(stats[0].total_spent),
      firstVisit: stats[0].first_visit,
      lastVisit: stats[0].last_visit,
      avgMinutes: stats[0].avg_minutes ? Math.round(parseFloat(stats[0].avg_minutes)) : null,
    },
    pagination: {
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
}
module.exports = { list, getByPlate, getById, create, update, remove, getHistory };
