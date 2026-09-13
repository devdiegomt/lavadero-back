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
 * Error de credencial que no se pudo leer cifrada. Se distingue del resto para
 * que quien la atrape sepa que es de configuración y no de red ni de Alegra.
 */
export class CredencialIlegible extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'CredencialIlegible';
  }
}

/**
 * Descifra una credencial guardada en la base. **Exige que esté cifrada.**
 *
 * Antes existía `decryptIfNeeded`, que si el valor venía en texto plano lo
 * devolvía tal cual. Era cómodo para migrar y a la vez el agujero entero: una
 * credencial de facturación podía quedarse sin cifrar para siempre y el sistema
 * funcionaba igual, **sin que nada avisara**. Un cifrado que es opcional no es
 * una medida de seguridad, es una intención.
 *
 * Ahora falla, y el mensaje dice qué correr. Una factura que no sale queda en
 * `billing_errors` y se reintenta; una credencial en claro no se arregla sola.
 *
 * @param queEs nombre del campo, para que el error diga dónde mirar.
 */
export function descifrarCredencial(
  value: string | null | undefined,
  queEs = 'la credencial',
): string | null {
  if (!value) return null;

  if (!isEncrypted(value)) {
    throw new CredencialIlegible(
      `${queEs} está guardada en texto plano. Ciframe con: npm run db:encrypt-billing-keys ` +
        '(en producción: docker compose exec backend npm run db:encrypt-billing-keys:prod).',
    );
  }

  try {
    return decrypt(value);
  } catch {
    // El error de GCM ("unable to authenticate data") no le dice nada a nadie.
    // Las dos causas reales son éstas, y conviene nombrarlas.
    throw new CredencialIlegible(
      `${queEs} no se pudo descifrar. O ENCRYPTION_KEY no es la que se usó para ` +
        'cifrarla —revisa si se rotó sin correr db:rotate-key— o el valor guardado no es ' +
        'un cifrado válido.',
    );
  }
}