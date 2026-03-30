/**
 * Seed de datos de prueba.
 * Ejecutar: npm run db:seed
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./index');

async function seed() {
  console.log('🌱 Insertando datos de prueba...');

  try {
    // Limpiar datos existentes (en orden por foreign keys)
    await pool.query(`
      DELETE FROM payments;
      DELETE FROM appointment_status_log;
      DELETE FROM appointments;
      DELETE FROM vehicles;
      DELETE FROM customers;
      DELETE FROM services;
      DELETE FROM refresh_tokens;
      DELETE FROM users;
      DELETE FROM tenants;
    `);

    // Tenant de prueba
    const tenantId = 'a0000000-0000-0000-0000-000000000001';
    await pool.query(`
      INSERT INTO tenants (id, name, slug, nit, owner_name, phone, email, address, city, bays_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      tenantId,
      'Lavadero El Brillante',
      'el-brillante',
      '900123456-7',
      'Carlos Rodríguez',
      '+573001234567',
      'admin@elbrillante.co',
      'Cra 15 #45-67, Local 101',
      'Bogotá',
      3,
    ]);

    // Usuarios
    const passwordHash = await bcrypt.hash('admin123', 10);

    await pool.query(`
      INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, phone, role)
      VALUES
        ('b0000000-0000-0000-0000-000000000001', $1, 'admin@elbrillante.co', $2, 'Carlos', 'Rodríguez', '+573001234567', 'admin'),
        ('b0000000-0000-0000-0000-000000000002', $1, 'juan@elbrillante.co', $2, 'Juan', 'López', '+573009876543', 'operator'),
        ('b0000000-0000-0000-0000-000000000003', $1, 'maria@elbrillante.co', $2, 'María', 'Torres', '+573005551234', 'operator')
    `, [tenantId, passwordHash]);

    // Servicios
    await pool.query(`
      INSERT INTO services (tenant_id, name, description, price_sedan, price_suv, price_camioneta, price_moto, price_pickup, estimated_minutes, sort_order)
      VALUES
        ($1, 'Lavado Básico', 'Lavado exterior con agua, jabón y secado manual', 2500000, 3500000, 3500000, 1500000, 3500000, 30, 1),
        ($1, 'Lavado Completo', 'Lavado exterior + interior: aspirado, limpieza de tablero y vidrios', 4000000, 5500000, 5500000, 2500000, 5500000, 60, 2),
        ($1, 'Lavado Premium', 'Lavado completo + encerado + protector de llantas + ambientador', 6000000, 7500000, 7500000, 4000000, 7500000, 90, 3),
        ($1, 'Detailing', 'Lavado premium + descontaminación + pulido + ceramic coating básico', 12000000, 15000000, 15000000, 8000000, 15000000, 180, 4),
        ($1, 'Solo Aspirado', 'Aspirado interior completo', 1500000, 2000000, 2000000, 0, 2000000, 20, 5)
    `, [tenantId]);

    // Clientes
    await pool.query(`
      INSERT INTO customers (id, tenant_id, first_name, last_name, phone, email, document_type, document_number)
      VALUES
        ('c0000000-0000-0000-0000-000000000001', $1, 'María', 'García', '+573101112233', 'maria.garcia@gmail.com', 'CC', '52345678'),
        ('c0000000-0000-0000-0000-000000000002', $1, 'Pedro', 'Martínez', '+573204445566', NULL, 'CC', '80123456'),
        ('c0000000-0000-0000-0000-000000000003', $1, 'Laura', 'Sánchez', '+573157778899', 'laura.sanchez@outlook.com', 'CC', '1098765432'),
        ('c0000000-0000-0000-0000-000000000004', $1, 'Andrés', 'Ramírez', '+573118889900', NULL, 'CC', '79876543'),
        ('c0000000-0000-0000-0000-000000000005', $1, 'Camila', 'Herrera', '+573176665544', 'camila.h@gmail.com', 'CC', '1045678901')
    `, [tenantId]);

    // Vehículos
    await pool.query(`
      INSERT INTO vehicles (id, tenant_id, customer_id, plate, vehicle_type, brand, model, color, year)
      VALUES
        ('d0000000-0000-0000-0000-000000000001', $1, 'c0000000-0000-0000-0000-000000000001', 'ABC123', 'sedan', 'Chevrolet', 'Spark GT', 'Blanco', 2021),
        ('d0000000-0000-0000-0000-000000000002', $1, 'c0000000-0000-0000-0000-000000000002', 'XYZ789', 'suv', 'Renault', 'Duster', 'Gris', 2023),
        ('d0000000-0000-0000-0000-000000000003', $1, 'c0000000-0000-0000-0000-000000000003', 'JKL456', 'camioneta', 'Toyota', 'Hilux', 'Negro', 2022),
        ('d0000000-0000-0000-0000-000000000004', $1, 'c0000000-0000-0000-0000-000000000001', 'MNO321', 'moto', 'Yamaha', 'MT-03', 'Azul', 2024),
        ('d0000000-0000-0000-0000-000000000005', $1, 'c0000000-0000-0000-0000-000000000004', 'PQR654', 'pickup', 'Ford', 'Ranger', 'Rojo', 2020),
        ('d0000000-0000-0000-0000-000000000006', $1, 'c0000000-0000-0000-0000-000000000005', 'STU987', 'sedan', 'Mazda', '3', 'Plateado', 2022)
    `, [tenantId]);

    console.log('✅ Seed completado:');
    console.log('   📋 1 tenant (Lavadero El Brillante)');
    console.log('   👤 3 usuarios (admin: admin@elbrillante.co / admin123)');
    console.log('   🧽 5 servicios');
    console.log('   🧑 5 clientes');
    console.log('   🚗 6 vehículos');
  } catch (err) {
    console.error('❌ Error en seed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
