const db = require('../../shared/db');
const { AppError } = require('../../shared/middleware/errorHandler');
const { getServicePrice } = require('../../shared/utils/pricing');
const { notifyVehicleReady } = require('../whatsapp/notifications');
const { getTenantToday } = require('../../shared/utils/dateUtils');

// Transiciones de estado válidas
const VALID_TRANSITIONS = {
  pending:     ['in_progress', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done:        ['delivered', 'cancelled'],
  delivered:   [],       // Estado final
  cancelled:   [],       // Estado final
};

// ---------------------------------------------------------------------------
// GET /api/appointments?date=2024-03-15&status=pending&page=1
// ---------------------------------------------------------------------------
async function list(req, res) {
  const { date, status, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [req.tenantId];
  let conditions = ['a.tenant_id = $1'];

  if (date) {
    params.push(date);
    conditions.push(`a.scheduled_date = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }

  const where = conditions.join(' AND ');
  params.push(parseInt(limit), offset);

  const { rows } = await db.query(
    `SELECT a.*,
            c.first_name as customer_first_name, c.last_name as customer_last_name, c.phone as customer_phone,
            v.plate, v.vehicle_type, v.brand, v.model, v.color,
            s.name as service_name, s.estimated_minutes,
            u.first_name as operator_first_name, u.last_name as operator_last_name
     FROM appointments a
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = a.assigned_to
     WHERE ${where}
     ORDER BY a.scheduled_time ASC NULLS LAST, a.created_at ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const countResult = await db.query(
    `SELECT COUNT(*) FROM appointments a WHERE ${where}`,
    params.slice(0, -2)
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

// ---------------------------------------------------------------------------
// GET /api/appointments/today
// ---------------------------------------------------------------------------
async function today(req, res) {
  const todayDate = await getTenantToday(req.tenantId);

  const { rows } = await db.query(
    `SELECT a.*,
            c.first_name as customer_first_name, c.last_name as customer_last_name, c.phone as customer_phone,
            v.plate, v.vehicle_type, v.brand, v.model, v.color,
            s.name as service_name, s.estimated_minutes,
            u.first_name as operator_first_name, u.last_name as operator_last_name
     FROM appointments a
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = a.assigned_to
     WHERE a.tenant_id = $1 AND a.scheduled_date = $2
     ORDER BY
       CASE a.status
         WHEN 'in_progress' THEN 1
         WHEN 'pending' THEN 2
         WHEN 'done' THEN 3
         WHEN 'delivered' THEN 4
         WHEN 'cancelled' THEN 5
       END,
       a.scheduled_time ASC NULLS LAST,
       a.created_at ASC`,
    [req.tenantId, todayDate]
  );

  res.json(rows);
}

// ---------------------------------------------------------------------------
// GET /api/appointments/:id
// ---------------------------------------------------------------------------
async function getById(req, res) {
  const { rows } = await db.query(
    `SELECT a.*,
            c.first_name as customer_first_name, c.last_name as customer_last_name, c.phone as customer_phone, c.email as customer_email,
            v.plate, v.vehicle_type, v.brand, v.model, v.color, v.year,
            s.name as service_name, s.estimated_minutes, s.description as service_description,
            u.first_name as operator_first_name, u.last_name as operator_last_name
     FROM appointments a
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = a.assigned_to
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [req.params.id, req.tenantId]
  );

  if (rows.length === 0) throw new AppError('Turno no encontrado', 404);

  // Incluir log de estados
  const { rows: log } = await db.query(
    `SELECT sl.*, u.first_name, u.last_name
     FROM appointment_status_log sl
     LEFT JOIN users u ON u.id = sl.changed_by
     WHERE sl.appointment_id = $1
     ORDER BY sl.created_at ASC`,
    [req.params.id]
  );

  res.json({ ...rows[0], status_log: log });
}

// ---------------------------------------------------------------------------
// POST /api/appointments
// ---------------------------------------------------------------------------
async function create(req, res) {
  const { customerId, vehicleId, serviceId, scheduledDate, scheduledTime, assignedTo, bayNumber, notes, source } = req.body;

  if (!customerId || !vehicleId || !serviceId || !scheduledDate) {
    throw new AppError('Cliente, vehículo, servicio y fecha son requeridos', 400);
  }

  // Obtener servicio y vehículo para calcular precio
  const { rows: serviceRows } = await db.query(
    'SELECT * FROM services WHERE id = $1 AND tenant_id = $2 AND is_active = true',
    [serviceId, req.tenantId]
  );
  if (serviceRows.length === 0) throw new AppError('Servicio no encontrado o inactivo', 404);

  const { rows: vehicleRows } = await db.query(
    'SELECT vehicle_type FROM vehicles WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [vehicleId, req.tenantId]
  );
  if (vehicleRows.length === 0) throw new AppError('Vehículo no encontrado', 404);

  const price = getServicePrice(serviceRows[0], vehicleRows[0].vehicle_type);

  const { rows } = await db.query(
    `INSERT INTO appointments
      (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, scheduled_time, assigned_to, bay_number, price, notes, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [req.tenantId, customerId, vehicleId, serviceId, scheduledDate,
     scheduledTime || null, assignedTo || null, bayNumber || null,
     price, notes?.trim() || null, source || 'walk_in']
  );

  // Log de creación
  await db.query(
    `INSERT INTO appointment_status_log (appointment_id, new_status, changed_by)
     VALUES ($1, 'pending', $2)`,
    [rows[0].id, req.user.id]
  );

  res.status(201).json(rows[0]);
}

// ---------------------------------------------------------------------------
// PATCH /api/appointments/:id
// ---------------------------------------------------------------------------
async function update(req, res) {
  const fieldMap = {
    serviceId: 'service_id', scheduledDate: 'scheduled_date',
    scheduledTime: 'scheduled_time', assignedTo: 'assigned_to',
    bayNumber: 'bay_number', notes: 'notes', price: 'price',
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
    `UPDATE appointments SET ${updates.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1}
       AND status NOT IN ('delivered', 'cancelled')
     RETURNING *`,
    values
  );

  if (rows.length === 0) throw new AppError('Turno no encontrado o ya finalizado', 404);
  res.json(rows[0]);
}

// ---------------------------------------------------------------------------
// PATCH /api/appointments/:id/status
// ---------------------------------------------------------------------------
async function changeStatus(req, res) {
  const { status: newStatus, notes } = req.body;

  if (!newStatus) throw new AppError('El nuevo estado es requerido', 400);

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Obtener estado actual (con lock para evitar race conditions)
    const { rows: current } = await client.query(
      'SELECT id, status, customer_id FROM appointments WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [req.params.id, req.tenantId]
    );

    if (current.length === 0) {
      await client.query('ROLLBACK');
      throw new AppError('Turno no encontrado', 404);
    }

    const currentStatus = current[0].status;

    // Validar transición
    const validNext = VALID_TRANSITIONS[currentStatus];
    if (!validNext || !validNext.includes(newStatus)) {
      await client.query('ROLLBACK');
      throw new AppError(
        `No se puede cambiar de "${currentStatus}" a "${newStatus}". Transiciones válidas: ${validNext?.join(', ') || 'ninguna (estado final)'}`,
        400
      );
    }

    // Construir update con timestamps apropiados
    const timestampMap = {
      in_progress: 'started_at',
      done: 'completed_at',
      delivered: 'delivered_at',
      cancelled: 'cancelled_at',
    };

    const tsField = timestampMap[newStatus];
    const tsUpdate = tsField ? `, ${tsField} = NOW()` : '';

    const { rows } = await client.query(
      `UPDATE appointments SET status = $1 ${tsUpdate}
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [newStatus, req.params.id, req.tenantId]
    );

    // Log del cambio
    await client.query(
      `INSERT INTO appointment_status_log (appointment_id, previous_status, new_status, changed_by, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, currentStatus, newStatus, req.user.id, notes || null]
    );

    // Actualizar visit_count y last_visit_at del cliente cuando se entrega
    if (newStatus === 'delivered') {
      await client.query(
        `UPDATE customers SET visit_count = visit_count + 1, last_visit_at = NOW()
         WHERE id = $1`,
        [rows[0].customer_id]
      );
    }

    await client.query('COMMIT');

    // Notificar por WhatsApp si el vehículo está listo (fire-and-forget, fuera de la transacción)
    if (newStatus === 'done') {
      notifyVehicleReady(req.params.id, req.tenantId).catch(err => {
        console.error('[WhatsApp] Error enviando notificación:', err.message);
      });
    }

    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// POST /api/appointments/quick
// Turno rápido: busca o crea cliente + vehículo + turno en una sola operación.
// El flujo más usado en el día a día del lavadero.
// ---------------------------------------------------------------------------
async function quickCreate(req, res) {
  const {
    // Cliente
    customerPhone, customerFirstName, customerLastName,
    // Vehículo
    plate, vehicleType, brand, model, color,
    // Turno
    serviceId, scheduledTime, assignedTo, bayNumber, notes,
  } = req.body;

  if (!customerPhone || !customerFirstName || !plate || !serviceId) {
    throw new AppError('Teléfono, nombre del cliente, placa y servicio son requeridos', 400);
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // 1. Buscar o crear cliente
    let customerId;
    const { rows: existingCustomers } = await client.query(
      'SELECT id FROM customers WHERE phone = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1',
      [customerPhone.trim(), req.tenantId]
    );

    if (existingCustomers.length > 0) {
      customerId = existingCustomers[0].id;
      // Actualizar nombre si se proporcionó (por si lo corrigieron)
      await client.query(
        'UPDATE customers SET first_name = $1, last_name = $2 WHERE id = $3',
        [customerFirstName.trim(), customerLastName?.trim() || null, customerId]
      );
    } else {
      const { rows: newCustomer } = await client.query(
        `INSERT INTO customers (tenant_id, first_name, last_name, phone)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.tenantId, customerFirstName.trim(), customerLastName?.trim() || null, customerPhone.trim()]
      );
      customerId = newCustomer[0].id;
    }

    // 2. Buscar o crear vehículo
    let vehicleId;
    const { rows: existingVehicles } = await client.query(
      'SELECT id FROM vehicles WHERE UPPER(plate) = UPPER($1) AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1',
      [plate.trim(), req.tenantId]
    );

    if (existingVehicles.length > 0) {
      vehicleId = existingVehicles[0].id;
    } else {
      const { rows: newVehicle } = await client.query(
        `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type, brand, model, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.tenantId, customerId, plate.toUpperCase().trim(),
         vehicleType || 'sedan', brand?.trim() || null, model?.trim() || null, color?.trim() || null]
      );
      vehicleId = newVehicle[0].id;
    }

    // 3. Obtener precio del servicio
    const { rows: serviceRows } = await client.query(
      'SELECT * FROM services WHERE id = $1 AND tenant_id = $2 AND is_active = true',
      [serviceId, req.tenantId]
    );
    if (serviceRows.length === 0) {
      throw new AppError('Servicio no encontrado o inactivo', 404);
    }

    const { rows: vehRows } = await client.query(
      'SELECT vehicle_type FROM vehicles WHERE id = $1', [vehicleId]
    );
    const price = getServicePrice(serviceRows[0], vehRows[0].vehicle_type);

    // 4. Crear turno
    const todayDate = await getTenantToday(req.tenantId);
    const { rows: appointment } = await client.query(
      `INSERT INTO appointments
        (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, scheduled_time, assigned_to, bay_number, price, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'walk_in')
       RETURNING *`,
      [req.tenantId, customerId, vehicleId, serviceId, todayDate,
       scheduledTime || null, assignedTo || null, bayNumber || null,
       price, notes?.trim() || null]
    );

    // Log
    await client.query(
      `INSERT INTO appointment_status_log (appointment_id, new_status, changed_by)
       VALUES ($1, 'pending', $2)`,
      [appointment[0].id, req.user.id]
    );

    await client.query('COMMIT');

    // Re-fetch con joins para devolver datos completos
    const { rows: full } = await db.query(
      `SELECT a.*,
              c.first_name as customer_first_name, c.last_name as customer_last_name, c.phone as customer_phone,
              v.plate, v.vehicle_type, v.brand, v.model, v.color,
              s.name as service_name, s.estimated_minutes
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       JOIN vehicles v ON v.id = a.vehicle_id
       JOIN services s ON s.id = a.service_id
       WHERE a.id = $1`,
      [appointment[0].id]
    );

    res.status(201).json(full[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { list, today, getById, create, update, changeStatus, quickCreate };
