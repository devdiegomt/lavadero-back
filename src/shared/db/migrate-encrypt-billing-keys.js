/**
 * Migra los billing_api_key existentes de texto plano a cifrado AES-256-GCM.
 *
 * Idempotente: si un valor ya está cifrado, lo deja como está.
 * Requiere ENCRYPTION_KEY configurada en .env.
 *
 * Ejecutar:
 *   npm run db:encrypt-billing-keys
 *
 * Importante: una vez cifrados los valores, el back NO puede operar sin la
 * misma ENCRYPTION_KEY. Guárdala en un lugar seguro.
 */

require('dotenv').config();
const { pool } = require('./index');
const { encrypt, isEncrypted } = require('../utils/crypto');

async function migrate() {
  console.log('🔐 Migrando billing_api_key a formato cifrado...');

  const { rows } = await pool.query(
    `SELECT id, name, billing_api_key
     FROM tenants
     WHERE billing_api_key IS NOT NULL`
  );

  let migrated = 0;
  let alreadyEncrypted = 0;

  for (const tenant of rows) {
    if (isEncrypted(tenant.billing_api_key)) {
      alreadyEncrypted++;
      continue;
    }

    const ciphertext = encrypt(tenant.billing_api_key);
    await pool.query(
      `UPDATE tenants SET billing_api_key = $1 WHERE id = $2`,
      [ciphertext, tenant.id]
    );
    console.log(`   ✔ ${tenant.name} (${tenant.id})`);
    migrated++;
  }

  console.log(`\n✅ Cifrado completado:`);
  console.log(`   📋 Tenants procesados: ${rows.length}`);
  console.log(`   🔒 Cifrados ahora: ${migrated}`);
  console.log(`   ✓  Ya estaban cifrados: ${alreadyEncrypted}`);
}

migrate()
  .catch(err => {
    console.error('❌ Error en migración:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
