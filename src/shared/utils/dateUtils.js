/**
 * Utilidades de fecha con soporte de timezone por tenant.
 * 
 * Corrige PEN-001: new Date().toISOString() devuelve UTC.
 * En Colombia (UTC-5) después de las 7pm la fecha es incorrecta.
 * 
 * Corrige PEN-004: formatCOP que no depende del locale del servidor.
 * 
 * Uso:
 *   const { getTenantToday, formatCOPSafe } = require('../../shared/utils/dateUtils');
 *   const today = await getTenantToday(req.tenantId);
 */

const db = require('../db');

// Cache de timezones (raramente cambia)
const tzCache = new Map();

/**
 * Obtiene la fecha actual en la timezone del tenant.
 * @param {string} tenantId
 * @returns {Promise<string>} YYYY-MM-DD
 */
async function getTenantToday(tenantId) {
  const tz = await getTenantTimezone(tenantId);
  return getDateInTimezone(tz);
}

/**
 * Timezone del tenant con cache.
 */
async function getTenantTimezone(tenantId) {
  if (tzCache.has(tenantId)) return tzCache.get(tenantId);

  const { rows } = await db.query('SELECT timezone FROM tenants WHERE id = $1', [tenantId]);
  const tz = rows[0]?.timezone || 'America/Bogota';
  tzCache.set(tenantId, tz);
  setTimeout(() => tzCache.delete(tenantId), 10 * 60 * 1000); // limpiar cada 10 min
  return tz;
}

/**
 * Fecha actual en una timezone específica.
 * @param {string} timezone - ej: 'America/Bogota'
 * @returns {string} YYYY-MM-DD
 */
function getDateInTimezone(timezone) {
  try {
    // Intl.DateTimeFormat con 'en-CA' produce formato YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    // Fallback manual para Colombia (UTC-5)
    const now = new Date();
    now.setHours(now.getHours() - 5);
    return now.toISOString().split('T')[0];
  }
}

/**
 * Formatea centavos COP como string legible.
 * No depende del locale del servidor (funciona en Docker Alpine).
 * 
 * @param {number} centavos
 * @returns {string} ej: "$25.000"
 */
function formatCOPSafe(centavos) {
  const pesos = Math.round(centavos / 100);
  return '$' + pesos.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

module.exports = { getTenantToday, getTenantTimezone, getDateInTimezone, formatCOPSafe };
