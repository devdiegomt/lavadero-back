/**
 * Tareas programadas (cron jobs).
 * 
 * Se ejecutan con setInterval. Para producción real considerar
 * node-cron o pg_cron si la complejidad lo amerita.
 * 
 * Inicializar desde index.js:
 *   const { initCronJobs } = require('./shared/db/cron');
 *   initCronJobs();
 */

const db = require('./index');
const logger = require('../utils/logger');

/**
 * Limpia refresh tokens expirados o revocados (> 1 día).
 * Ejecutar cada 6 horas.
 */
async function cleanExpiredTokens() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM refresh_tokens
       WHERE expires_at < NOW() - INTERVAL '1 day'
          OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '1 day')`
    );
    if (rowCount > 0) {
      logger.info({ cleaned: rowCount }, 'Tokens expirados limpiados');
    }
  } catch (err) {
    logger.error({ err }, 'Error limpiando tokens');
  }
}

/**
 * Refresca la materialized view mv_daily_summary.
 * Ejecutar cada 15 minutos.
 */
async function refreshDailySummary() {
  try {
    await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_summary');
  } catch {
    try {
      await db.query('REFRESH MATERIALIZED VIEW mv_daily_summary');
    } catch (err) {
      logger.error({ err }, 'Error refrescando mv_daily_summary');
    }
  }
}

/**
 * Limpia billing_errors resueltos de más de 30 días.
 * Ejecutar cada 24 horas.
 */
async function cleanOldBillingErrors() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM billing_errors
       WHERE resolved_at IS NOT NULL AND resolved_at < NOW() - INTERVAL '30 days'`
    );
    if (rowCount > 0) {
      logger.info({ cleaned: rowCount }, 'Billing errors antiguos limpiados');
    }
  } catch (err) {
    logger.error({ err }, 'Error limpiando billing errors');
  }
}

/**
 * Inicializa todos los cron jobs. Llamar una vez desde index.js.
 */
function initCronJobs() {
  setInterval(cleanExpiredTokens, 6 * 60 * 60 * 1000);      // cada 6h
  setInterval(refreshDailySummary, 15 * 60 * 1000);          // cada 15 min
  setInterval(cleanOldBillingErrors, 24 * 60 * 60 * 1000);   // cada 24h

  // Ejecutar limpieza al inicio
  cleanExpiredTokens();

  logger.info('Cron jobs inicializados');
}

module.exports = { initCronJobs, cleanExpiredTokens, refreshDailySummary, cleanOldBillingErrors };
