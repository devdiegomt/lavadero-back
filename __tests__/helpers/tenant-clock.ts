/**
 * Fija la zona horaria del tenant de forma que su hora local sea ~09:00,
 * sin importar cuándo se corran los tests.
 *
 * La disponibilidad de turnos depende de la hora del lavadero: corriendo a
 * las 23:00 UTC no quedaría ningún horario libre antes del cierre y los
 * tests de agendamiento fallarían por el reloj, no por el código.
 *
 * **Hay que restaurar la zona al terminar**, con `restaurarHoraDelTenant()`.
 * No hacerlo dejaba al tenant en una zona arbitraria para las suites
 * siguientes, y eso hacía fallar los recordatorios de forma intermitente
 * —según qué suite corriera antes— sin ninguna relación aparente con el
 * cambio que se estuviera probando.
 */
import * as db from '../../src/shared/db';

export async function fijarHoraDelTenantEnLaManana(slug = 'el-brillante'): Promise<void> {
  const utcHour = new Date().getUTCHours();
  // Etc/GMT tiene el signo invertido: Etc/GMT-3 es UTC+3.
  let offset = 9 - utcHour;
  if (offset > 14) offset -= 24;
  if (offset < -11) offset += 24;
  const tz = offset >= 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;

  await db.query(
    `UPDATE tenants
     SET timezone = $1, opening_time = '07:00', closing_time = '19:00'
     WHERE slug = $2`,
    [tz, slug],
  );
}

/**
 * Devuelve al tenant su zona por defecto.
 *
 * Va en el `afterAll` de toda suite que llame a la función de arriba: el
 * estado que una suite deja es el que la siguiente encuentra, y una zona
 * horaria ajena convierte un fallo real en un misterio de orden de ejecución.
 */
export async function restaurarHoraDelTenant(slug = 'el-brillante'): Promise<void> {
  await db.query(
    `UPDATE tenants SET timezone = 'America/Bogota' WHERE slug = $1`,
    [slug],
  );
}
