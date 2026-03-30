/**
 * DEMO SEED - Datos realistas para presentación al cliente.
 * Genera turnos de hoy en distintos estados, pagos, historial.
 * Ejecutar: npm run db:demo
 *
 * Usa esto DESPUÉS de npm run db:seed (que crea el tenant, users, services, etc.)
 */
require('dotenv').config();
const { pool } = require('./index');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'b0000000-0000-0000-0000-000000000001';
const OPERATOR1 = 'b0000000-0000-0000-0000-000000000002';
const OPERATOR2 = 'b0000000-0000-0000-0000-000000000003';

// Realistic Colombian customers
const DEMO_CUSTOMERS = [
  { fn: 'Andrea', ln: 'Ospina', phone: '+573124567890', doc: '52987654' },
  { fn: 'Santiago', ln: 'Mejía', phone: '+573209871234', doc: '80456789' },
  { fn: 'Valentina', ln: 'Ríos', phone: '+573156543210', doc: '1098234567' },
  { fn: 'Diego', ln: 'Castillo', phone: '+573187654321', doc: '79345678' },
  { fn: 'Camila', ln: 'Vargas', phone: '+573001239876', doc: '1045671234' },
  { fn: 'Mateo', ln: 'Gómez', phone: '+573114567123', doc: '80567890' },
  { fn: 'Isabella', ln: 'Muñoz', phone: '+573175559876', doc: '52678901' },
  { fn: 'Sebastián', ln: 'Restrepo', phone: '+573209993344', doc: '1087654321' },
  { fn: 'Sofía', ln: 'Duque', phone: '+573146667788', doc: '52789012' },
  { fn: 'Nicolás', ln: 'Salazar', phone: '+573058881122', doc: '80678901' },
];

const DEMO_VEHICLES = [
  { plate: 'FGH234', type: 'sedan', brand: 'Renault', model: 'Logan', color: 'Blanco', year: 2022, ci: 0 },
  { plate: 'KLM567', type: 'suv', brand: 'Kia', model: 'Sportage', color: 'Gris', year: 2023, ci: 1 },
  { plate: 'NOP890', type: 'sedan', brand: 'Chevrolet', model: 'Onix', color: 'Rojo', year: 2021, ci: 2 },
  { plate: 'QRS123', type: 'camioneta', brand: 'Toyota', model: 'Fortuner', color: 'Negro', year: 2023, ci: 3 },
  { plate: 'TUV456', type: 'moto', brand: 'Honda', model: 'CB190R', color: 'Negro', year: 2024, ci: 4 },
  { plate: 'WXY789', type: 'sedan', brand: 'Mazda', model: '2', color: 'Azul', year: 2022, ci: 5 },
  { plate: 'BCD012', type: 'suv', brand: 'Hyundai', model: 'Tucson', color: 'Blanco', year: 2024, ci: 6 },
  { plate: 'EFG345', type: 'pickup', brand: 'Nissan', model: 'Frontier', color: 'Plateado', year: 2021, ci: 7 },
  { plate: 'HIJ678', type: 'sedan', brand: 'Volkswagen', model: 'Gol', color: 'Gris', year: 2020, ci: 8 },
  { plate: 'LMN901', type: 'suv', brand: 'Ford', model: 'Territory', color: 'Azul', year: 2023, ci: 9 },
];

async function demoSeed() {
  console.log('🎭 Generando datos demo para presentación...\n');

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];

  try {
    // Clean previous demo data (keep seed data)
    await pool.query("DELETE FROM payments WHERE tenant_id = $1", [TENANT_ID]);
    await pool.query("DELETE FROM appointment_status_log WHERE appointment_id IN (SELECT id FROM appointments WHERE tenant_id = $1)", [TENANT_ID]);
    await pool.query("DELETE FROM appointments WHERE tenant_id = $1", [TENANT_ID]);

    // Get services
    const { rows: services } = await pool.query(
      'SELECT * FROM services WHERE tenant_id = $1 AND is_active = true ORDER BY sort_order',
      [TENANT_ID]
    );

    // Create demo customers
    const customerIds = [];
    for (const c of DEMO_CUSTOMERS) {
      const { rows } = await pool.query(
        `INSERT INTO customers (tenant_id, first_name, last_name, phone, document_type, document_number)
         VALUES ($1, $2, $3, $4, 'CC', $5)
         ON CONFLICT ON CONSTRAINT uq_customers_phone_skip DO NOTHING
         RETURNING id`,
        [TENANT_ID, c.fn, c.ln, c.phone, c.doc]
      );
      // If conflict, just find existing
      if (rows.length === 0) {
        const { rows: existing } = await pool.query(
          'SELECT id FROM customers WHERE phone = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1',
          [c.phone, TENANT_ID]
        );
        customerIds.push(existing[0]?.id);
      } else {
        customerIds.push(rows[0].id);
      }
    }

    // Create demo vehicles
    const vehicleIds = [];
    for (const v of DEMO_VEHICLES) {
      const custId = customerIds[v.ci];
      if (!custId) continue;
      const { rows } = await pool.query(
        `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type, brand, model, color, year)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING
         RETURNING id, vehicle_type`,
        [TENANT_ID, custId, v.plate, v.type, v.brand, v.model, v.color, v.year]
      );
      if (rows.length === 0) {
        const { rows: existing } = await pool.query(
          "SELECT id, vehicle_type FROM vehicles WHERE UPPER(plate) = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1",
          [v.plate, TENANT_ID]
        );
        vehicleIds.push(existing[0]);
      } else {
        vehicleIds.push(rows[0]);
      }
    }

    // Helper to get price
    function getPrice(service, vehicleType) {
      return service[`price_${vehicleType}`] || service.price_sedan;
    }

    // Create historical appointments (past 2 days)
    const pastDays = [twoDaysAgo, yesterday];
    for (const day of pastDays) {
      for (let i = 0; i < 8; i++) {
        const veh = vehicleIds[i % vehicleIds.length];
        const svc = services[i % services.length];
        if (!veh) continue;
        const price = getPrice(svc, veh.vehicle_type);
        const hour = 7 + i;

        const { rows: apt } = await pool.query(
          `INSERT INTO appointments
            (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, scheduled_time,
             assigned_to, bay_number, price, status, source,
             started_at, completed_at, delivered_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'delivered', 'walk_in',
                   $5::date + $6::time, $5::date + $6::time + interval '45 min', $5::date + $6::time + interval '50 min')
           RETURNING id`,
          [TENANT_ID, customerIds[i % customerIds.length], veh.id, svc.id,
           day, `${String(hour).padStart(2, '0')}:00`,
           i % 2 === 0 ? OPERATOR1 : OPERATOR2, (i % 3) + 1, price]
        );

        // Payment for each delivered
        const methods = ['cash', 'nequi', 'daviplata', 'transfer', 'card'];
        await pool.query(
          `INSERT INTO payments (tenant_id, appointment_id, amount, payment_method, received_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [TENANT_ID, apt[0].id, price, methods[i % methods.length],
           i % 2 === 0 ? OPERATOR1 : OPERATOR2]
        );
      }
    }

    // TODAY'S appointments in various states
    const todayAppointments = [
      // Delivered (early morning)
      { vi: 0, si: 1, time: '07:30', status: 'delivered', bay: 1, op: OPERATOR1, method: 'nequi' },
      { vi: 1, si: 2, time: '07:45', status: 'delivered', bay: 2, op: OPERATOR2, method: 'cash' },
      { vi: 2, si: 0, time: '08:15', status: 'delivered', bay: 3, op: OPERATOR1, method: 'daviplata' },
      { vi: 3, si: 1, time: '09:00', status: 'delivered', bay: 1, op: OPERATOR2, method: 'transfer' },
      // Done (waiting to be picked up)
      { vi: 4, si: 0, time: '10:00', status: 'done', bay: 2, op: OPERATOR1 },
      { vi: 5, si: 2, time: '10:30', status: 'done', bay: 1, op: OPERATOR2 },
      // In progress (currently washing)
      { vi: 6, si: 1, time: '11:00', status: 'in_progress', bay: 1, op: OPERATOR1 },
      { vi: 7, si: 3, time: '11:15', status: 'in_progress', bay: 2, op: OPERATOR2 },
      { vi: 8, si: 0, time: '11:30', status: 'in_progress', bay: 3, op: OPERATOR1 },
      // Pending (waiting in queue)
      { vi: 9, si: 1, time: '12:00', status: 'pending', op: null },
      { vi: 0, si: 2, time: '12:30', status: 'pending', op: null },
      { vi: 1, si: 0, time: '13:00', status: 'pending', op: null },
    ];

    for (const apt of todayAppointments) {
      const veh = vehicleIds[apt.vi];
      const svc = services[apt.si % services.length];
      if (!veh) continue;
      const price = getPrice(svc, veh.vehicle_type);

      let startedAt = null, completedAt = null, deliveredAt = null;
      if (['in_progress', 'done', 'delivered'].includes(apt.status)) {
        startedAt = `${today} ${apt.time}:00`;
      }
      if (['done', 'delivered'].includes(apt.status)) {
        completedAt = `${today} ${apt.time}:00`;
        // Add estimated service time
        const mins = svc.estimated_minutes || 45;
        const d = new Date(`${today}T${apt.time}:00`);
        d.setMinutes(d.getMinutes() + mins);
        completedAt = d.toISOString();
      }
      if (apt.status === 'delivered') {
        const d = new Date(completedAt);
        d.setMinutes(d.getMinutes() + 5);
        deliveredAt = d.toISOString();
      }

      const { rows } = await pool.query(
        `INSERT INTO appointments
          (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, scheduled_time,
           assigned_to, bay_number, price, status, source,
           started_at, completed_at, delivered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'walk_in', $11, $12, $13)
         RETURNING id`,
        [TENANT_ID, customerIds[apt.vi % customerIds.length], veh.id, svc.id,
         today, apt.time, apt.op, apt.bay || null, price, apt.status,
         startedAt, completedAt, deliveredAt]
      );

      // Status log
      await pool.query(
        `INSERT INTO appointment_status_log (appointment_id, new_status, changed_by) VALUES ($1, 'pending', $2)`,
        [rows[0].id, ADMIN_ID]
      );
      if (['in_progress', 'done', 'delivered'].includes(apt.status)) {
        await pool.query(
          `INSERT INTO appointment_status_log (appointment_id, previous_status, new_status, changed_by)
           VALUES ($1, 'pending', 'in_progress', $2)`,
          [rows[0].id, apt.op || ADMIN_ID]
        );
      }
      if (['done', 'delivered'].includes(apt.status)) {
        await pool.query(
          `INSERT INTO appointment_status_log (appointment_id, previous_status, new_status, changed_by)
           VALUES ($1, 'in_progress', 'done', $2)`,
          [rows[0].id, apt.op || ADMIN_ID]
        );
      }
      if (apt.status === 'delivered') {
        await pool.query(
          `INSERT INTO appointment_status_log (appointment_id, previous_status, new_status, changed_by)
           VALUES ($1, 'done', 'delivered', $2)`,
          [rows[0].id, apt.op || ADMIN_ID]
        );
        // Payment
        await pool.query(
          `INSERT INTO payments (tenant_id, appointment_id, amount, payment_method, received_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [TENANT_ID, rows[0].id, price, apt.method || 'cash', apt.op || ADMIN_ID]
        );
      }
    }

    // Update customer visit counts
    await pool.query(`
      UPDATE customers c SET
        visit_count = (SELECT COUNT(*) FROM appointments a WHERE a.customer_id = c.id AND a.status = 'delivered'),
        last_visit_at = (SELECT MAX(delivered_at) FROM appointments a WHERE a.customer_id = c.id AND a.status = 'delivered')
      WHERE c.tenant_id = $1
    `, [TENANT_ID]);

    // Refresh materialized view
    await pool.query('REFRESH MATERIALIZED VIEW mv_daily_summary');

    // Count results
    const { rows: counts } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM customers WHERE tenant_id = $1 AND deleted_at IS NULL) as customers,
        (SELECT COUNT(*) FROM vehicles WHERE tenant_id = $1 AND deleted_at IS NULL) as vehicles,
        (SELECT COUNT(*) FROM appointments WHERE tenant_id = $1) as appointments,
        (SELECT COUNT(*) FROM appointments WHERE tenant_id = $1 AND scheduled_date = $2) as today_appointments,
        (SELECT COUNT(*) FROM payments WHERE tenant_id = $1) as payments
    `, [TENANT_ID, today]);

    const c = counts[0];
    console.log('✅ Demo seed completado:');
    console.log(`   👥 ${c.customers} clientes`);
    console.log(`   🚗 ${c.vehicles} vehículos`);
    console.log(`   📋 ${c.appointments} turnos total (${c.today_appointments} hoy)`);
    console.log(`   💰 ${c.payments} pagos`);
    console.log(`\n   📊 Hoy: 3 esperando · 3 lavando · 2 listos · 4 entregados`);
    console.log(`   🔐 Login: admin@elbrillante.co / admin123\n`);

  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.message.includes('uq_customers_phone_skip')) {
      console.log('💡 Tip: La constraint no existe. Los customers se crearán normalmente.');
    }
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

demoSeed();
