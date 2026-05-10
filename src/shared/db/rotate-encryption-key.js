/**
 * Rota la ENCRYPTION_KEY de forma segura.
 *
 * Uso:
 *   1. Genera una nueva key:
 *      node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 *   2. En tu .env, agrega la nueva como NEW_ENCRYPTION_KEY (deja la actual
 *      como ENCRYPTION_KEY):
 *        ENCRYPTION_KEY=<la-vieja>
 *        NEW_ENCRYPTION_KEY=<la-nueva>
 *
 *   3. Ejecuta:
 *        node src/shared/db/rotate-encryption-key.js
 *
 *   4. Cuando termine sin errores, actualiza .env:
 *        ENCRYPTION_KEY=<la-nueva>
 *        # remueve NEW_ENCRYPTION_KEY
 *
 *   5. Reinicia el backend.
 *
 * El script:
 *   - Lee todos los billing_api_key cifrados con la key vieja.
 *   - Los descifra con ENCRYPTION_KEY (vieja).
 *   - Los re-cifra con NEW_ENCRYPTION_KEY (nueva).
 *   - Hace UPDATE en la BD.
 *
 * Es idempotente: si por alguna razón un valor ya está cifrado con la nueva key
 * (porque el script fue interrumpido a mitad), lo detecta y lo deja como está.
 *
 * IMPORTANTE: hacer backup de la BD ANTES de ejecutar. Si algo falla
 * a la mitad, podrías quedar con un mix de keys vieja y nueva imposibles
 * de recuperar.
 */

require('dotenv').config();
const { pool } = require('./index');
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SEPARATOR = ':';

function loadKey(envVar) {
  const raw = process.env[envVar];
  if (!raw) throw new Error(`${envVar} no está configurada en .env`);
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`${envVar} debe ser 64 caracteres hex (32 bytes).`);
  }
  return Buffer.from(raw, 'hex');
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(SEPARATOR);
}

function tryDecrypt(ciphertext, key) {
  const parts = String(ciphertext).split(SEPARATOR);
  if (parts.length !== 3) return null;
  try {
    const [iv, authTag, encrypted] = parts.map(p => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null; // No descifró con esta key
  }
}

async function rotate() {
  console.log('🔁 Rotando ENCRYPTION_KEY...\n');

  const oldKey = loadKey('ENCRYPTION_KEY');
  const newKey = loadKey('NEW_ENCRYPTION_KEY');

  if (oldKey.equals(newKey)) {
    throw new Error('ENCRYPTION_KEY y NEW_ENCRYPTION_KEY son iguales. No hay nada que rotar.');
  }

  const { rows } = await pool.query(
    `SELECT id, name, billing_api_key
     FROM tenants
     WHERE billing_api_key IS NOT NULL`
  );

  let rotated = 0;
  let alreadyNew = 0;
  let failed = 0;

  for (const tenant of rows) {
    // Intenta descifrar con la NUEVA primero (idempotencia)
    const tryNew = tryDecrypt(tenant.billing_api_key, newKey);
    if (tryNew !== null) {
      alreadyNew++;
      continue;
    }

    // Descifra con la vieja
    const plaintext = tryDecrypt(tenant.billing_api_key, oldKey);
    if (plaintext === null) {
      console.error(`   ✘ ${tenant.name} (${tenant.id}): no descifra con ninguna key`);
      failed++;
      continue;
    }

    const newCipher = encrypt(plaintext, newKey);
    await pool.query(
      `UPDATE tenants SET billing_api_key = $1 WHERE id = $2`,
      [newCipher, tenant.id]
    );
    console.log(`   ✔ ${tenant.name} (${tenant.id})`);
    rotated++;
  }

  console.log(`\n✅ Rotación completada:`);
  console.log(`   📋 Tenants procesados: ${rows.length}`);
  console.log(`   🔁 Rotados: ${rotated}`);
  console.log(`   ✓  Ya tenían la nueva key: ${alreadyNew}`);
  if (failed > 0) {
    console.log(`   ❌ Fallaron: ${failed} (revisar manualmente)`);
  }

  console.log(`\n👉 Próximos pasos:`);
  console.log(`   1. Verifica que el backend puede leer billing_api_key con la nueva key`);
  console.log(`   2. Edita .env: ENCRYPTION_KEY = (la nueva), elimina NEW_ENCRYPTION_KEY`);
  console.log(`   3. Reinicia el backend`);
  console.log(`   4. Borra cualquier copia de la key vieja de tu password manager`);

  return failed === 0;
}

rotate()
  .then(ok => {
    process.exit(ok ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ Error en rotación:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());