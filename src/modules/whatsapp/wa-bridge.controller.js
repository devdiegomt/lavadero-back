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
const { getServicePrice } = require('../../shared/utils/pricing');

// vehicles.vehicle_type: determina cual columna price_* aplica.
const VEHICLE_TYPES = ['sedan', 'suv', 'camioneta', 'moto', 'pickup'];

// ---------------------------------------------------------------------------
// GET /api/wa-bridge/appointment-status?plate=XXX
// Devuelve el turno activo (pending/confirmed/in_progress) para una placa.
// ---------------------------------------------------------------------------
async function getAppointmentStatus(req, res) {
  const { plate } = req.query;

  if (!plate || typeof plate !== 'string') {
    return res.status(400).json({ error: 'plate es requerido' });
  }

  // appointments guarda fecha y hora en columnas separadas y no tiene
  // deleted_at. scheduled_at se compone aca para no cambiar el contrato.
  const { rows } = await db.query(
    `SELECT
       a.id,
       a.status,
       a.scheduled_date,
       a.scheduled_time,
       (a.scheduled_date + COALESCE(a.scheduled_time, '00:00'::time)) AS scheduled_at,
       a.price,
       v.plate,
       v.brand,
       v.model,
       v.color,
       s.name              AS service_name,
       s.estimated_minutes AS duration_minutes,
       u.first_name        AS staff_name
     FROM appointments a
     JOIN vehicles  v ON v.id = a.vehicle_id
     JOIN services  s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = a.assigned_to
     WHERE a.tenant_id = $1
       AND UPPER(v.plate) = UPPER($2)
       AND a.status IN ('pending', 'in_progress', 'done')
     ORDER BY a.scheduled_date ASC, a.scheduled_time ASC NULLS LAST
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
  // services no tiene columna price ni deleted_at: el precio depende del tipo
  // de vehiculo (price_sedan, price_suv, ...) y se devuelven todos.
  const { rows } = await db.query(
    `SELECT id, name, description, estimated_minutes,
            price_sedan, price_suv, price_camioneta, price_moto, price_pickup
     FROM services
     WHERE tenant_id = $1
       AND is_active = true
     ORDER BY sort_order, name`,
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

  // El precio real cobrado vive en appointments.price, no en services.
  const { rows: history } = await db.query(
    `SELECT
       a.id,
       a.status,
       a.scheduled_date,
       a.scheduled_time,
       (a.scheduled_date + COALESCE(a.scheduled_time, '00:00'::time)) AS scheduled_at,
       a.price,
       v.plate,
       v.brand,
       v.model,
       s.name AS service_name
     FROM appointments a
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     WHERE a.tenant_id = $1
       AND a.customer_id = $2
     ORDER BY a.scheduled_date DESC, a.scheduled_time DESC NULLS LAST
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
// Body: { phone, customerName, plate, vehicleType, brand, model, color,
//         serviceId, scheduledDate, scheduledTime }
//   scheduledDate: 'YYYY-MM-DD'  (appointments.scheduled_date, NOT NULL)
//   scheduledTime: 'HH:MM'       (appointments.scheduled_time, opcional)
// El precio se calcula del servicio segun el tipo de vehiculo.
// ---------------------------------------------------------------------------
async function bookAppointment(req, res) {
  const {
    phone, customerName, plate, vehicleType, brand, model, color,
    serviceId, scheduledDate, scheduledTime,
  } = req.body;
  const tenantId = req.tenantId;

  if (!phone || !plate || !serviceId || !scheduledDate) {
    return res
      .status(400)
      .json({ error: 'phone, plate, serviceId, scheduledDate son requeridos' });
  }

  const type = VEHICLE_TYPES.includes(vehicleType) ? vehicleType : 'sedan';

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // El precio depende del tipo de vehiculo y appointments.price es NOT NULL.
    const { rows: svc } = await client.query(
      `SELECT price_sedan, price_suv, price_camioneta, price_moto, price_pickup
       FROM services
       WHERE id = $1 AND tenant_id = $2 AND is_active = true
       LIMIT 1`,
      [serviceId, tenantId]
    );
    if (!svc[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }
    const price = getServicePrice(svc[0], type);

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

      // customers no tiene columna source.
      const { rows: newCust } = await client.query(
        `INSERT INTO customers (tenant_id, phone, first_name, last_name)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [tenantId, phone, firstName, lastName || null]
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
        `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type, brand, model, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          tenantId,
          customerId,
          plate.toUpperCase(),
          type,
          brand || null,
          model || null,
          color || null,
        ]
      );
      vehicleId = newVeh[0].id;
    }

    // 3. Crear turno. customer_id es NOT NULL y la fecha/hora van separadas.
    const { rows: appt } = await client.query(
      `INSERT INTO appointments
         (tenant_id, customer_id, vehicle_id, service_id,
          scheduled_date, scheduled_time, price, status, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 'whatsapp')
       RETURNING id, status, scheduled_date, scheduled_time, price`,
      [
        tenantId,
        customerId,
        vehicleId,
        serviceId,
        scheduledDate,
        scheduledTime || null,
        price,
      ]
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
// Body: { phone, direction, content, flowStep, messageId }
//   direction: 'inbound' | 'outbound' | 'system'
//   flowStep:  el intent detectado, para saber qué ramas usa la gente
//   messageId: el ID del mensaje de WhatsApp, se guarda en external_id
// ---------------------------------------------------------------------------
async function logMessage(req, res) {
  const { phone, direction, content, flowStep, messageId } = req.body;

  if (!phone || !direction || !content) {
    return res
      .status(400)
      .json({ error: 'phone, direction y content son requeridos' });
  }

  const validDirections = ['inbound', 'outbound', 'system'];
  if (!validDirections.includes(direction)) {
    return res.status(400).json({ error: 'direction invalido' });
  }

  // phone es VARCHAR(20): un valor mas largo reventaria en la BD con un 500.
  // Mejor rechazarlo aca con un error claro.
  if (String(phone).length > 20) {
    return res.status(400).json({ error: 'phone excede 20 caracteres' });
  }

  await db.query(
    `INSERT INTO whatsapp_messages
       (tenant_id, phone, direction, message_type, content, flow_step, external_id)
     VALUES ($1, $2, $3, 'text', $4, $5, $6)`,
    [
      req.tenantId,
      phone,
      direction,
      String(content).substring(0, 2000),
      flowStep ? String(flowStep).substring(0, 50) : null,
      messageId ? String(messageId).substring(0, 100) : null,
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
