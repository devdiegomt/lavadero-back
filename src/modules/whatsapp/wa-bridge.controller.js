/**
 * wa-bridge.controller.js
 *
 * Endpoints internos consumidos exclusivamente por n8n.
 * NO requieren JWT del frontend — usan N8N_API_KEY + x-tenant-phone.
 *
 * Endpoints:
 *   GET  /api/wa-bridge/appointment-status?plate=XXX
 *   GET  /api/wa-bridge/services
 *   GET  /api/wa-bridge/customer-history?phone=XXX
 *   POST /api/wa-bridge/book
 *   POST /api/wa-bridge/log
 */

const db = require('../../shared/db');

// ---------------------------------------------------------------------------
// GET /api/wa-bridge/appointment-status?plate=XXX
// Devuelve el turno activo (pending/confirmed/in_progress) para una placa.
// ---------------------------------------------------------------------------
async function getAppointmentStatus(req, res) {
  const { plate } = req.query;

  if (!plate || typeof plate !== 'string') {
    return res.status(400).json({ error: 'plate es requerido' });
  }

  const { rows } = await db.query(
    `SELECT
       a.id,
       a.status,
       a.scheduled_at,
       v.plate,
       v.brand,
       v.model,
       v.color,
       s.name          AS service_name,
       s.duration_minutes,
       u.first_name    AS staff_name
     FROM appointments a
     JOIN vehicles  v ON v.id = a.vehicle_id
     JOIN services  s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = a.assigned_to
     WHERE a.tenant_id = $1
       AND UPPER(v.plate) = UPPER($2)
       AND a.status IN ('pending', 'confirmed', 'in_progress')
       AND a.deleted_at IS NULL
     ORDER BY a.scheduled_at ASC
     LIMIT 1`,
    [req.tenantId, plate.trim()]
  );

  if (!rows[0]) {
    return res.json({ found: false });
  }

  res.json({ found: true, appointment: rows[0] });
}

// ---------------------------------------------------------------------------
// GET /api/wa-bridge/services
// Lista todos los servicios activos del tenant con precios.
// ---------------------------------------------------------------------------
async function getServices(req, res) {
  const { rows } = await db.query(
    `SELECT id, name, description, price, duration_minutes, category
     FROM services
     WHERE tenant_id = $1
       AND is_active = true
       AND deleted_at IS NULL
     ORDER BY category, price ASC`,
    [req.tenantId]
  );

  res.json({ services: rows });
}

// ---------------------------------------------------------------------------
// GET /api/wa-bridge/customer-history?phone=XXX
// Devuelve el cliente y sus últimas 5 citas.
// ---------------------------------------------------------------------------
async function getCustomerHistory(req, res) {
  const { phone } = req.query;

  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: 'phone es requerido' });
  }

  const { rows: customers } = await db.query(
    `SELECT id, first_name, last_name, visit_count
     FROM customers
     WHERE tenant_id = $1
       AND phone = $2
       AND deleted_at IS NULL
     LIMIT 1`,
    [req.tenantId, phone.trim()]
  );

  const customer = customers[0];
  if (!customer) {
    return res.json({ found: false });
  }

  const { rows: history } = await db.query(
    `SELECT
       a.id,
       a.status,
       a.scheduled_at,
       v.plate,
       v.brand,
       v.model,
       s.name  AS service_name,
       s.price
     FROM appointments a
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     WHERE a.tenant_id = $1
       AND v.customer_id = $2
       AND a.deleted_at IS NULL
     ORDER BY a.scheduled_at DESC
     LIMIT 5`,
    [req.tenantId, customer.id]
  );

  res.json({
    found: true,
    customer: {
      name: `${customer.first_name} ${customer.last_name}`.trim(),
      visit_count: customer.visit_count,
    },
    history,
  });
}

// ---------------------------------------------------------------------------
// POST /api/wa-bridge/book
// Crea o reutiliza cliente + vehículo y registra un turno.
//
// Body: { phone, customerName, plate, brand, model, color, serviceId, scheduledAt }
// ---------------------------------------------------------------------------
async function bookAppointment(req, res) {
  const { phone, customerName, plate, brand, model, color, serviceId, scheduledAt } =
    req.body;
  const tenantId = req.tenantId;

  if (!phone || !plate || !serviceId || !scheduledAt) {
    return res
      .status(400)
      .json({ error: 'phone, plate, serviceId, scheduledAt son requeridos' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // 1. Upsert cliente
    let customerId;
    const { rows: existing } = await client.query(
      `SELECT id FROM customers
       WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [tenantId, phone]
    );

    if (existing[0]) {
      customerId = existing[0].id;
    } else {
      const nameParts = (customerName || 'Cliente WA').trim().split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || '';

      const { rows: newCust } = await client.query(
        `INSERT INTO customers (tenant_id, phone, first_name, last_name, source)
         VALUES ($1, $2, $3, $4, 'whatsapp')
         RETURNING id`,
        [tenantId, phone, firstName, lastName]
      );
      customerId = newCust[0].id;
    }

    // 2. Upsert vehículo
    let vehicleId;
    const { rows: existingVeh } = await client.query(
      `SELECT id FROM vehicles
       WHERE tenant_id = $1 AND customer_id = $2 AND UPPER(plate) = UPPER($3)
         AND deleted_at IS NULL
       LIMIT 1`,
      [tenantId, customerId, plate]
    );

    if (existingVeh[0]) {
      vehicleId = existingVeh[0].id;
    } else {
      const { rows: newVeh } = await client.query(
        `INSERT INTO vehicles (tenant_id, customer_id, plate, brand, model, color)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          tenantId,
          customerId,
          plate.toUpperCase(),
          brand || '',
          model || '',
          color || '',
        ]
      );
      vehicleId = newVeh[0].id;
    }

    // 3. Crear turno
    const { rows: appt } = await client.query(
      `INSERT INTO appointments
         (tenant_id, vehicle_id, service_id, scheduled_at, status, source)
       VALUES ($1, $2, $3, $4, 'pending', 'whatsapp')
       RETURNING id, status, scheduled_at`,
      [tenantId, vehicleId, serviceId, scheduledAt]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      appointment: appt[0],
      customerId,
      vehicleId,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[wa-bridge] Error en bookAppointment:', err.message);
    res.status(500).json({ error: 'Error al registrar el turno' });
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// POST /api/wa-bridge/log
// Registra un mensaje en whatsapp_messages para auditoría.
//
// Body: { phone, direction, content, flowStep }
// ---------------------------------------------------------------------------
async function logMessage(req, res) {
  const { phone, direction, content, flowStep } = req.body;

  if (!phone || !direction || !content) {
    return res
      .status(400)
      .json({ error: 'phone, direction y content son requeridos' });
  }

  const validDirections = ['inbound', 'outbound', 'system'];
  if (!validDirections.includes(direction)) {
    return res.status(400).json({ error: 'direction invalido' });
  }

  await db.query(
    `INSERT INTO whatsapp_messages
       (tenant_id, phone, direction, message_type, content, flow_step)
     VALUES ($1, $2, $3, 'text', $4, $5)`,
    [
      req.tenantId,
      phone,
      direction,
      String(content).substring(0, 2000),
      flowStep || null,
    ]
  );

  res.status(201).json({ ok: true });
}

module.exports = {
  getAppointmentStatus,
  getServices,
  getCustomerHistory,
  bookAppointment,
  logMessage,
};
