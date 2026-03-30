const db = require('../../shared/db');
const { AppError } = require('../../shared/middleware/errorHandler');

// GET /api/customers?search=xxx&page=1&limit=20
async function list(req, res) {
  const { search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [req.tenantId];
  let where = 'c.tenant_id = $1 AND c.deleted_at IS NULL';

  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    where += ` AND (
      c.first_name ILIKE $${i} OR
      c.last_name ILIKE $${i} OR
      c.phone ILIKE $${i} OR
      c.document_number ILIKE $${i} OR
      EXISTS (SELECT 1 FROM vehicles v WHERE v.customer_id = c.id AND v.deleted_at IS NULL AND UPPER(v.plate) ILIKE UPPER($${i}))
    )`;
  }

  const countResult = await db.query(
    `SELECT COUNT(*) FROM customers c WHERE ${where}`, params
  );

  params.push(parseInt(limit), offset);
  const { rows } = await db.query(
    `SELECT c.id, c.first_name, c.last_name, c.phone, c.email,
            c.document_type, c.document_number, c.notes,
            c.visit_count, c.last_visit_at, c.created_at,
            (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id = c.id AND v.deleted_at IS NULL) as vehicle_count
     FROM customers c
     WHERE ${where}
     ORDER BY c.created_at DESC
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

// GET /api/customers/:id
async function getById(req, res) {
  const { rows } = await db.query(
    `SELECT c.*,
            json_agg(
              json_build_object(
                'id', v.id, 'plate', v.plate, 'vehicle_type', v.vehicle_type,
                'brand', v.brand, 'model', v.model, 'color', v.color, 'year', v.year
              ) ORDER BY v.created_at DESC
            ) FILTER (WHERE v.id IS NOT NULL) as vehicles
     FROM customers c
     LEFT JOIN vehicles v ON v.customer_id = c.id AND v.deleted_at IS NULL
     WHERE c.id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL
     GROUP BY c.id`,
    [req.params.id, req.tenantId]
  );

  if (rows.length === 0) throw new AppError('Cliente no encontrado', 404);
  res.json(rows[0]);
}

// POST /api/customers
async function create(req, res) {
  const { firstName, lastName, phone, email, documentType, documentNumber, notes } = req.body;

  if (!firstName || !phone) {
    throw new AppError('Nombre y teléfono son requeridos', 400);
  }

  const { rows } = await db.query(
    `INSERT INTO customers (tenant_id, first_name, last_name, phone, email, document_type, document_number, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [req.tenantId, firstName.trim(), lastName?.trim() || null, phone.trim(),
     email?.trim() || null, documentType || 'CC', documentNumber?.trim() || null, notes?.trim() || null]
  );

  res.status(201).json(rows[0]);
}

// PATCH /api/customers/:id
async function update(req, res) {
  const fieldMap = {
    firstName: 'first_name', lastName: 'last_name', phone: 'phone',
    email: 'email', documentType: 'document_type', documentNumber: 'document_number', notes: 'notes',
  };

  const updates = [];
  const values = [];
  let idx = 1;

  for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
    if (req.body[jsKey] !== undefined) {
      updates.push(`${dbKey} = $${idx}`);
      values.push(req.body[jsKey]);
      idx++;
    }
  }

  if (updates.length === 0) throw new AppError('No hay campos para actualizar', 400);

  values.push(req.params.id, req.tenantId);
  const { rows } = await db.query(
    `UPDATE customers SET ${updates.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
     RETURNING *`,
    values
  );

  if (rows.length === 0) throw new AppError('Cliente no encontrado', 404);
  res.json(rows[0]);
}

// DELETE /api/customers/:id (soft delete)
async function remove(req, res) {
  const { rows } = await db.query(
    `UPDATE customers SET deleted_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [req.params.id, req.tenantId]
  );

  if (rows.length === 0) throw new AppError('Cliente no encontrado', 404);
  res.json({ message: 'Cliente eliminado' });
}

// GET /api/customers/:id/vehicles
async function getVehicles(req, res) {
  const { rows } = await db.query(
    `SELECT * FROM vehicles
     WHERE customer_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [req.params.id, req.tenantId]
  );
  res.json(rows);
}


// GET /api/customers/:id/history?page=1&limit=20
async function getHistory(req, res) {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const { rows: cRows } = await db.query(
    'SELECT id FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [req.params.id, req.tenantId]
  );
  if (cRows.length === 0) throw new AppError('Cliente no encontrado', 404);

  const countResult = await db.query(
    'SELECT COUNT(*) FROM appointments WHERE customer_id = $1', [req.params.id]
  );

  const { rows } = await db.query(
    `SELECT a.id, a.scheduled_date, a.scheduled_time, a.status, a.price, a.source,
            a.started_at, a.completed_at, a.delivered_at,
            s.name as service_name,
            v.plate, v.brand, v.model, v.color, v.vehicle_type,
            p.amount as payment_amount, p.payment_method
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     JOIN vehicles v ON v.id = a.vehicle_id
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.customer_id = $1
     ORDER BY a.scheduled_date DESC, a.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.params.id, parseInt(limit), offset]
  );

  // Stats
  const { rows: stats } = await db.query(
    `SELECT
       COUNT(*) as total_visits,
       COALESCE(SUM(p.amount), 0) as total_spent,
       MIN(a.scheduled_date) as first_visit,
       MAX(a.scheduled_date) as last_visit,
       (SELECT s.name FROM appointments a2
        JOIN services s ON s.id = a2.service_id
        WHERE a2.customer_id = $1 AND a2.status = 'delivered'
        GROUP BY s.name ORDER BY COUNT(*) DESC LIMIT 1) as favorite_service
     FROM appointments a
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.customer_id = $1`,
    [req.params.id]
  );

  res.json({
    data: rows,
    stats: {
      totalVisits: parseInt(stats[0].total_visits),
      totalSpent: parseInt(stats[0].total_spent),
      firstVisit: stats[0].first_visit,
      lastVisit: stats[0].last_visit,
      favoriteService: stats[0].favorite_service,
    },
    pagination: {
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
}
module.exports = { list, getById, create, update, remove, getVehicles, getHistory };
