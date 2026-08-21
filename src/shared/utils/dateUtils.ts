/**
 * Utilidades de fecha con soporte de timezone por tenant.
 *
 * Corrige PEN-001: `new Date().toISOString()` devuelve UTC.
 * En Colombia (UTC-5) después de las 7pm la fecha sería incorrecta.
 */

import * as db from '../db';

// Cache de timezones (raramente cambia; TTL 10 min)
const tzCache = new Map<string, string>();

/**
 * Obtiene la fecha actual (YYYY-MM-DD) en la timezone del tenant.
 */
export async function getTenantToday(tenantId: string): Promise<string> {
  const tz = await getTenantTimezone(tenantId);
  return getDateInTimezone(tz);
}

/**
 * Timezone del tenant, con cache de 10 minutos.
 */
export async function getTenantTimezone(tenantId: string): Promise<string> {
  const cached = tzCache.get(tenantId);
  if (cached) return cached;

  const { rows } = await db.query<{ timezone: string }>(
    'SELECT timezone FROM tenants WHERE id = $1',
    [tenantId],
  );

  const tz = rows[0]?.timezone ?? 'America/Bogota';
  tzCache.set(tenantId, tz);
  setTimeout(() => tzCache.delete(tenantId), 10 * 60 * 1_000);
  return tz;
}

/**
 * Fecha actual en una timezone específica.
 * @returns 'YYYY-MM-DD'
 */
export function getDateInTimezone(timezone: string): string {
  try {
    // `en-CA` locale produce formato YYYY-MM-DD nativo
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    // Fallback manual para Colombia (UTC-5)
    const now = new Date();
    now.setHours(now.getHours() - 5);
    return now.toISOString().split('T')[0];
  }
}

/**
 * Formatea centavos COP sin depender del locale del servidor.
 * Funciona en Docker Alpine donde `toLocaleString` puede fallar.
 * @returns '$25.000'
 */
export function formatCOPSafe(centavos: number): string {
  const pesos = Math.round(centavos / 100);
  return '$' + pesos.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}