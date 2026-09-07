/**
 * Hashing de contraseñas.
 *
 * El costo vive acá y no repetido en cada llamada: estaba escrito a mano en
 * cinco lugares, así que subirlo implicaba encontrarlos todos y era cuestión
 * de tiempo que uno quedara atrás.
 */
import bcrypt from 'bcryptjs';

/**
 * Costo de bcrypt. Cada punto duplica el trabajo de calcular el hash — y el de
 * probar contraseñas contra la base si alguna vez se filtra.
 *
 * 12 es la recomendación actual de OWASP. Subirlo no invalida los hashes
 * existentes: bcrypt guarda el costo dentro del propio hash, así que los de 10
 * siguen validando y se rehashean cuando el usuario cambia su contraseña.
 *
 * Configurable para poder bajarlo en los tests, donde 12 rondas por cada
 * usuario creado se nota.
 */
export const BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS
  ? parseInt(process.env.BCRYPT_ROUNDS, 10)
  : 12;

/** Hashea una contraseña con el costo del proyecto. */
export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

/** Verifica una contraseña contra su hash. */
export function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * ¿El hash quedó con un costo menor al actual?
 *
 * Permite rehashear al vuelo cuando alguien inicia sesión con una contraseña
 * cuyo hash es viejo, en lugar de esperar a que la cambie.
 */
export function necesitaRehash(hash: string): boolean {
  // Formato: $2a$<costo>$<sal+hash>
  const partes = hash.split('$');
  const costo = parseInt(partes[2] ?? '', 10);
  return Number.isFinite(costo) && costo < BCRYPT_ROUNDS;
}
