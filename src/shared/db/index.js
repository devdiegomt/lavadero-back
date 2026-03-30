const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway/Render usan SSL en producción
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log de conexión (solo en dev)
pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('📦 Conectado a PostgreSQL');
  }
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en PostgreSQL:', err.message);
});

/**
 * Ejecuta una query con parámetros.
 * Uso: const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
 */
const query = (text, params) => pool.query(text, params);

/**
 * Obtiene un cliente del pool para transacciones.
 * Uso:
 *   const client = await db.getClient();
 *   try {
 *     await client.query('BEGIN');
 *     // ... queries ...
 *     await client.query('COMMIT');
 *   } catch (e) {
 *     await client.query('ROLLBACK');
 *     throw e;
 *   } finally {
 *     client.release();
 *   }
 */
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
