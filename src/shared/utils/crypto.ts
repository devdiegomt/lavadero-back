/**
 * Cifrado AES-256-GCM para datos sensibles en BD (billing_api_key, etc.).
 *
 * Formato del valor cifrado: "iv:authTag:ciphertext" (todo base64).
 *
 * Usa process.env.ENCRYPTION_KEY directamente (no config) para que los
 * scripts de rotación puedan importar este módulo standalone.
 * config.ts valida el formato correcto al arrancar el servidor web.
 *
 * Generar la key:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits — recomendado para GCM
const SEPARATOR = ':';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY no está configurada. ' +
        "Generar con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('ENCRYPTION_KEY debe ser 64 caracteres hex (32 bytes).');
  }

  cachedKey = Buffer.from(raw, 'hex');
  return cachedKey;
}

/**
 * Cifra un string con AES-256-GCM.
 * Devuelve null si la entrada es falsy.
 */
export function encrypt(plaintext: string | null | undefined): string | null {
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
 * Devuelve null si la entrada es falsy.
 * Lanza si el valor está malformado o la key es incorrecta.
 */
export function decrypt(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;

  const parts = String(ciphertext).split(SEPARATOR);
  if (parts.length !== 3) {
    throw new Error('Formato cifrado inválido (se esperan 3 partes separadas por ":")');
  }

  const [iv, authTag, encrypted] = parts.map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Detecta si un valor está en formato cifrado (3 partes base64 separadas por ":").
 * No falla si la entrada es plaintext — solo devuelve false.
 */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(SEPARATOR);
  if (parts.length !== 3) return false;
  return parts.every((p) => p.length > 0 && /^[A-Za-z0-9+/=]+$/.test(p));
}

/**
 * Devuelve el plaintext. Si está cifrado, lo descifra; si no, lo devuelve tal cual.
 * Útil mientras algunos valores están en texto plano y otros ya cifrados.
 */
export function decryptIfNeeded(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isEncrypted(value)) return decrypt(value);
  return value;
}