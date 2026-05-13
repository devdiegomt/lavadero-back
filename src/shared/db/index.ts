/**
 * Pool de conexiones PostgreSQL con query tipado.
 *
 * Usa process.env directamente (no config) para que los scripts de
 * migración y seed puedan importar este módulo standalone sin que
 * config.ts exija ENCRYPTION_KEY y otras vars del servidor web.
 *
 * Uso tipado en controllers:
 *   const { rows } = await db.query<AppointmentRow>(
 *     'SELECT * FROM appointments WHERE id = $1', [id]
 *   );
 *   // rows: AppointmentRow[]
 */

import { Pool, type PoolClient, type QueryResult } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway/Render/Fly usan SSL en producción
  ssl:
    process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Log de conexión (solo en dev)
pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('📦 Conectado a PostgreSQL');
  }
});

pool.on('error', (err: Error) => {
  console.error('❌ Error inesperado en PostgreSQL:', err.message);
});

/**
 * Ejecuta una query con parámetros opcionales.
 *
 * Genérico: T define el shape de cada fila devuelta.
 * Si no se especifica, devuelve `Record<string, unknown>`.
 *
 * Ejemplo:
 *   const { rows } = await db.query<UserRow>(
 *     'SELECT * FROM users WHERE tenant_id = $1 AND is_active = true',
 *     [tenantId]
 *   );
 */
export async function query<T extends object = Record<string, unknown>>(
  text: string,
  params?: (string | number | boolean | null | Date | undefined)[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

/**
 * Obtiene un cliente del pool para transacciones manuales.
 *
 * Siempre liberar el cliente en el bloque `finally`:
 *   const client = await db.getClient();
 *   try {
 *     await client.query('BEGIN');
 *     await client.query('INSERT INTO ...');
 *     await client.query('COMMIT');
 *   } catch (err) {
 *     await client.query('ROLLBACK');
 *     throw err;
 *   } finally {
 *     client.release();
 *   }
 */
export const getClient = (): Promise<PoolClient> => pool.connect();

/** Pool crudo — usar solo cuando query/getClient no sean suficientes. */
export { pool };