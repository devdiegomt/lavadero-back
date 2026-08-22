/**
 * Fija la zona horaria del tenant de forma que su hora local sea ~09:00,
 * sin importar cuándo se corran los tests.
 *
 * La disponibilidad de turnos depende de la hora del lavadero: corriendo a
 * las 23:00 UTC no quedaría ningún horario libre antes del cierre y los
 * tests de agendamiento fallarían por el reloj, no por el código.
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
