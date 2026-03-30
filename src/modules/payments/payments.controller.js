const db = require('../../shared/db');
const { AppError } = require('../../shared/middleware/errorHandler');

// GET /api/payments?from=2024-03-01&to=2024-03-31&method=cash&page=1&limit=30
async function list(req, res) {
  const { from, to, method, page = 1, limit = 30 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [req.tenantId];
  let conditions = ['p.tenant_id = $1'];

  if (from) {
    params.push(from);
    conditions.push(`p.created_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to + ' 23:59:59');
    conditions.push(`p.created_at <= $${params.length}::timestamp`);
  }
  if (method) {
    params.push(method);
    conditions.push(`p.payment_method = $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT COUNT(*) FROM payments p WHERE ${where}`, params
  );

  params.push(parseInt(limit), offset);
  const { rows } = await db.query(
    `SELECT p.*,
            a.scheduled_date, a.status as appointment_status,
            c.first_name as customer_first_name, c.last_name as customer_last_name, c.phone as customer_phone,
            v.plate, v.brand, v.model,
            s.name as service_name,
            u.first_name as received_by_name
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = p.received_by
     WHERE ${where}
     ORDER BY p.created_at DESC
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

// GET /api/payments/summary?from=2024-03-01&to=2024-03-31
async function summary(req, res) {
  const { from, to } = req.query;
  const params = [req.tenantId];
  let dateFilter = '';

  if (from) {
    params.push(from);
    dateFilter += ` AND p.created_at >= $${params.length}::date`;
  }
  if (to) {
    params.push(to + ' 23:59:59');
    dateFilter += ` AND p.created_at <= $${params.length}::timestamp`;
  }

  // Total general
  const { rows: totalRows } = await db.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
     FROM payments p
     WHERE p.tenant_id = $1 ${dateFilter}`,
    params
  );

  // Por método de pago
  const { rows: byMethod } = await db.query(
    `SELECT payment_method, COUNT(*) as count, SUM(amount) as total
     FROM payments p
     WHERE p.tenant_id = $1 ${dateFilter}
     GROUP BY payment_method
     ORDER BY total DESC`,
    params
  );

  // Por día (para gráfico)
  const { rows: byDay } = await db.query(
    `SELECT DATE(p.created_at) as date, COUNT(*) as count, SUM(amount) as total
     FROM payments p
     WHERE p.tenant_id = $1 ${dateFilter}
     GROUP BY DATE(p.created_at)
     ORDER BY date`,
    params
  );

  // Top servicios
  const { rows: byService } = await db.query(
    `SELECT s.name, COUNT(*) as count, SUM(p.amount) as total
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN services s ON s.id = a.service_id
     WHERE p.tenant_id = $1 ${dateFilter}
     GROUP BY s.name
     ORDER BY total DESC
     LIMIT 5`,
    params
  );

  res.json({
    total: {
      count: parseInt(totalRows[0].count),
      amount: parseInt(totalRows[0].total),
    },
    byMethod: byMethod.map(r => ({
      method: r.payment_method,
      count: parseInt(r.count),
      amount: parseInt(r.total),
    })),
    byDay: byDay.map(r => ({
      date: r.date,
      count: parseInt(r.count),
      amount: parseInt(r.total),
    })),
    byService: byService.map(r => ({
      name: r.name,
      count: parseInt(r.count),
      amount: parseInt(r.total),
    })),
  });
}

// GET /api/payments/:id
async function getById(req, res) {
  const { rows } = await db.query(
    `SELECT p.*,
            a.scheduled_date, c.first_name as customer_first_name, c.last_name as customer_last_name,
            v.plate, s.name as service_name
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     WHERE p.id = $1 AND p.tenant_id = $2`,
    [req.params.id, req.tenantId]
  );
  if (rows.length === 0) throw new AppError('Pago no encontrado', 404);
  res.json(rows[0]);
}

// POST /api/payments
async function create(req, res) {
  const { appointmentId, amount, paymentMethod, notes } = req.body;

  if (!appointmentId || !amount || !paymentMethod) {
    throw new AppError('Turno, monto y método de pago son requeridos', 400);
  }

  // Validar que el turno existe y pertenece al tenant
  const { rows: aptRows } = await db.query(
    'SELECT id, status, price FROM appointments WHERE id = $1 AND tenant_id = $2',
    [appointmentId, req.tenantId]
  );
  if (aptRows.length === 0) throw new AppError('Turno no encontrado', 404);

  // Validar que el turno esté en estado correcto para cobrar
  const validPaymentStatuses = ['done', 'delivered'];
  if (!validPaymentStatuses.includes(aptRows[0].status)) {
    throw new AppError(`Solo se puede registrar pago para turnos en estado "done" o "delivered". Estado actual: "${aptRows[0].status}"`, 400);
  }

  // Verificar que no exista un pago previo para este turno
  const { rows: existingPayment } = await db.query(
    'SELECT id FROM payments WHERE appointment_id = $1',
    [appointmentId]
  );
  if (existingPayment.length > 0) {
    throw new AppError('Este turno ya tiene un pago registrado', 409);
  }

  const { rows } = await db.query(
    `INSERT INTO payments (tenant_id, appointment_id, amount, payment_method, received_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [req.tenantId, appointmentId, amount, paymentMethod, req.user.id, notes?.trim() || null]
  );

  res.status(201).json(rows[0]);
}

module.exports = { list, summary, getById, create };
