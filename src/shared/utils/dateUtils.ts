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
  setTimeout(() => tzCache.delete(tenantId), 10 * 60 * 1_000).unref?.();
  return tz;
}

/**
 * Descarta la timezone cacheada de un tenant, o de todos si no se indica.
 *
 * La cache dura 10 minutos, así que sin esto un cambio de zona no se ve hasta
 * que vence — y una prueba que la cambia estaría comprobando la zona anterior
 * sin enterarse. También sirve si un tenant cambia su zona desde el panel.
 */
export function olvidarTimezone(tenantId?: string): void {
  if (tenantId) tzCache.delete(tenantId);
  else tzCache.clear();
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
 * Suma días a una fecha `YYYY-MM-DD` y devuelve otra `YYYY-MM-DD`.
 *
 * Existe para no calcular "mañana" con `new Date()`, que da el día del
 * servidor —UTC— y no el del lavadero. Entre la medianoche UTC y la local, las
 * dos fechas difieren, y el turno terminaba guardado un día corrido.
 *
 * Opera sobre la cadena, no sobre el reloj: la entrada ya viene resuelta en la
 * zona del tenant por `getTenantToday`, así que aquí no hay ninguna zona que
 * volver a considerar. El mediodía UTC evita que un cambio de horario de
 * verano mueva el resultado al día vecino.
 */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Fecha inválida: ${fecha} (se esperaba YYYY-MM-DD)`);
  }
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().split('T')[0];
}

/**
 * Hora actual en una timezone, como minutos desde medianoche.
 *
 * Necesario para comparar contra horarios de atención: el servidor corre en
 * UTC y usar su reloj descarta turnos que en la zona del lavadero todavía no
 * pasaron (y al revés, ofrece turnos vencidos después del cierre).
 *
 * @returns minutos desde las 00:00 en esa timezone (ej: 14:30 → 870)
 */
export function getMinutesOfDayInTimezone(timezone: string): number {
  try {
    const hhmm = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  } catch {
    // Fallback manual para Colombia (UTC-5)
    const now = new Date();
    const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    return (utcMin - 5 * 60 + 24 * 60) % (24 * 60);
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