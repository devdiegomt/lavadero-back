/**
 * Utilidades de cifrado para datos sensibles en BD.
 *
 * Usa AES-256-GCM (cifrado autenticado).
 * Formato del valor cifrado: "iv:authTag:ciphertext" todo en base64.
 *
 * Requiere ENCRYPTION_KEY en .env: 64 caracteres hexadecimales (32 bytes).
 * Generar con:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, recomendado para GCM
const SEPARATOR = ':';

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY no está configurada. Generar con: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('ENCRYPTION_KEY debe ser 64 caracteres hex (32 bytes).');
  }
  cachedKey = Buffer.from(raw, 'hex');
  return cachedKey;
}

/**
 * Cifra un string. Devuelve null si la entrada es falsy.
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
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

/**
 * Descifra un valor previamente cifrado con encrypt().
 */
function decrypt(ciphertext) {
  if (!ciphertext) return null;
  const parts = String(ciphertext).split(SEPARATOR);
  if (parts.length !== 3) {
    throw new Error('Formato cifrado inválido (se esperan 3 partes separadas por ":")');
  }
  const [iv, authTag, encrypted] = parts.map(p => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Detecta si un valor parece estar cifrado (3 partes base64 separadas por ":").
 * No falla si la entrada es plaintext — solo devuelve false.
 *
 * Sirve para manejar el período de migración donde algunos valores ya están
 * cifrados y otros todavía en texto plano.
 */
function isEncrypted(value) {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(SEPARATOR);
  if (parts.length !== 3) return false;
  return parts.every(p => {
    if (!p) return false;
    // Validar que sean base64 reales (sin caracteres prohibidos)
    return /^[A-Za-z0-9+/=]+$/.test(p);
  });
}

/**
 * Devuelve el valor en texto plano. Si está cifrado, lo descifra; si no,
 * lo retorna tal cual. Útil mientras se migra de plaintext a cifrado.
 */
function decryptIfNeeded(value) {
  if (!value) return null;
  if (isEncrypted(value)) return decrypt(value);
  return value;
}

module.exports = { encrypt, decrypt, isEncrypted, decryptIfNeeded };
