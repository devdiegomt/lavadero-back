/**
 * Seed para crear el usuario super_admin global.
 * Ejecutar: node src/shared/db/seed-superadmin.js
 * 
 * Este usuario NO pertenece a ningún tenant.
 * Tiene acceso a /api/superadmin/* exclusivamente.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from './index';
import { hashPassword } from '../utils/password';

async function seedSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL || 'superadmin@carwash-saas.com';
  const password = process.env.SUPER_ADMIN_PASSWORD || 'super123!';

  console.log('🔑 Creando usuario super_admin...');

  try {
    // Verificar si ya existe
    const { rows: existing } = await pool.query(
      "SELECT id FROM users WHERE email = $1 AND role = 'super_admin'",
      [email]
    );

    if (existing.length > 0) {
      console.log(`⚠️  Super admin ya existe: ${email}`);
      return;
    }

    const passwordHash = await hashPassword(password);

    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
       VALUES (NULL, $1, $2, 'Super', 'Admin', 'super_admin')`,
      [email, passwordHash]
    );

    console.log('✅ Super admin creado:');
    console.log(`   📧 Email: ${email}`);
    console.log(`   🔐 Password: ${password}`);
    console.log('   ⚠️  Cambia la contraseña en producción!');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedSuperAdmin();
