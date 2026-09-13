/**
 * Recordatorios de turno.
 *
 * El bot promete "te avisamos 30 min antes" al confirmar. Esa promesa no se
 * cumplía por tres razones a la vez: la función no estaba registrada en el
 * cron, enviaba por Twilio en vez de bot-wa, y exigía c.phone —que es NULL
 * para quien llega por WhatsApp, porque el número no lo entrega.
 */
import * as db from '../src/shared/db';
import { cruzandoTenants } from './helpers/rls';
import * as botWa from '../src/modules/whatsapp/bot-wa.client';
import { sendAppointmentReminders } from '../src/modules/whatsapp/notifications';

// `sendAppointmentReminders` recorre los turnos de TODOS los lavaderos: es una
// tarea de fondo, no una petición. En producción el cron la corre con el bypass
// de RLS explícito, y acá se hace igual — si la prueba usara un contexto de
// tenant estaría probando algo que no ocurre.

const LID = 'REM' + Date.now() + '@lid';
let tenantId: string;
let customerId: string;
let vehicleId: string;
let serviceId: string;

/**
 * Crea un turno a `minutos` de ahora, en la zona horaria del tenant.
 *
 * La fecha **y** la hora salen del mismo instante. Antes la fecha se tomaba del
 * "ahora" local y la hora del instante futuro, que para un turno pasada la
 * medianoche local daba una fila incoherente: fecha de ayer con hora de hoy.
 */
async function crearTurno(minutos: number): Promise<string> {
  const { rows } = await db.queryAdmin<{ hora: string; dia: string }>(
    `SELECT to_char(momento, 'HH24:MI') AS hora,
            to_char(momento, 'YYYY-MM-DD') AS dia
     FROM (
       SELECT (NOW() AT TIME ZONE t.timezone) + ($2 || ' minutes')::interval AS momento
       FROM tenants t WHERE t.id = $1
     ) q`,
    [tenantId, String(minutos)],
  );
  const { rows: appt } = await db.queryAdmin<{ id: string }>(
    `INSERT INTO appointments
       (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, scheduled_time,
        price, status, source)
     VALUES ($1, $2, $3, $4, $5, $6, 2500000, 'pending', 'whatsapp')
     RETURNING id`,
    [tenantId, customerId, vehicleId, serviceId, rows[0].dia, rows[0].hora],
  );
  return appt[0].id;
}

beforeAll(async () => {
  const { rows: t } = await db.queryAdmin<{ id: string }>(
    `UPDATE tenants SET whatsapp_enabled = true WHERE slug = 'el-brillante' RETURNING id`,
  );
  tenantId = t[0].id;

  // Cliente identificado sólo por LID: el caso real.
  const { rows: c } = await db.queryAdmin<{ id: string }>(
    `INSERT INTO customers (tenant_id, first_name, wa_lid) VALUES ($1, 'Diego', $2) RETURNING id`,
    [tenantId, LID],
  );
  customerId = c[0].id;

  const { rows: v } = await db.queryAdmin<{ id: string }>(
    `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type)
     VALUES ($1, $2, 'REM123', 'sedan') RETURNING id`,
    [tenantId, customerId],
  );
  vehicleId = v[0].id;

  const { rows: s } = await db.queryAdmin<{ id: string }>(
    `SELECT id FROM services WHERE tenant_id = $1 LIMIT 1`, [tenantId],
  );
  serviceId = s[0].id;
});

afterAll(async () => {
  await db.queryAdmin(`DELETE FROM whatsapp_messages WHERE wa_lid = $1`, [LID]);
  await db.queryAdmin(`DELETE FROM appointments WHERE customer_id = $1`, [customerId]);
  await db.queryAdmin(`DELETE FROM vehicles WHERE customer_id = $1`, [customerId]);
  await db.queryAdmin(`DELETE FROM customers WHERE id = $1`, [customerId]);
  await db.pool.end();
});

beforeEach(async () => {
  await db.queryAdmin(`DELETE FROM whatsapp_messages WHERE wa_lid = $1`, [LID]);
  await db.queryAdmin(`DELETE FROM appointments WHERE customer_id = $1`, [customerId]);
  jest.restoreAllMocks();
});

describe('la fecha se compara contra el día del lavadero', () => {
  // La consulta usaba CURRENT_DATE —el día del servidor, en UTC— mientras que
  // el turno se guarda con la fecha local del lavadero. Entre la medianoche
  // UTC y la local las dos no coinciden y no devolvía nada: los recordatorios
  // dejaban de salir en silencio.
  //
  // Se descubrió porque un cambio de orden de las suites dejó al tenant en
  // otra zona y estos tests empezaron a fallar sin relación aparente.
  afterEach(async () => {
    await db.queryAdmin(
      `UPDATE tenants SET timezone = 'America/Bogota' WHERE id = $1`, [tenantId],
    );
  });

  it('avisa aunque el lavadero esté en otro día que el servidor', async () => {
    // Zona elegida para caer al otro lado de la medianoche respecto de UTC.
    const utcHour = new Date().getUTCHours();
    const offset = utcHour < 12 ? -1 - utcHour : 25 - utcHour;
    const tz = offset >= 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
    await db.queryAdmin(`UPDATE tenants SET timezone = $1 WHERE id = $2`, [tz, tenantId]);

    const { rows } = await db.queryAdmin<{ distintos: boolean }>(
      `SELECT CURRENT_DATE <> (NOW() AT TIME ZONE timezone)::date AS distintos
       FROM tenants WHERE id = $1`, [tenantId],
    );
    // Guardia: si las fechas coincidieran, la prueba no probaría nada.
    expect(rows[0].distintos).toBe(true);

    await crearTurno(30);
    const enviar = jest.spyOn(botWa, 'enviarWhatsApp').mockResolvedValue({ enviado: true });

    await cruzandoTenants(() => sendAppointmentReminders());

    expect(enviar).toHaveBeenCalledTimes(1);
  });
});

describe('la ventana cruza la medianoche del lavadero', () => {
  /**
   * El bug: la ventana se comparaba sobre `scheduled_time` a secas, contra
   * `(ahora+25min)::time` y `(ahora+35min)::time`. `::time` descarta el día, así
   * que a las 23:40 locales quedaba `BETWEEN '00:05' AND '00:15'` con el
   * inferior mayor que el superior — y `BETWEEN` así no calza con nada.
   *
   * Resultado: **entre las 23:25 y la medianoche del lavadero no salía un solo
   * recordatorio, todos los días**, sin un error en el log. Y un turno a las
   * 00:10 tampoco, porque el `scheduled_date = hoy` lo excluía.
   *
   * Apareció corriendo las pruebas a las 23:26 de Bogotá. A cualquier otra hora
   * pasaban. Por eso esta prueba **fija** la hora local del lavadero en vez de
   * confiar en cuándo se ejecute.
   */
  afterEach(async () => {
    await db.queryAdmin(`UPDATE tenants SET timezone = 'America/Bogota' WHERE id = $1`, [tenantId]);
  });

  /**
   * Pone la hora local del tenant en `hhmm`, con precisión de minuto.
   *
   * PostgreSQL acepta un desplazamiento arbitrario como zona, con el signo
   * invertido al estilo POSIX: `AT TIME ZONE '-05:30'` es UTC+5:30. Eso permite
   * cualquier hora local, que es lo que hace falta para fijar el borde de la
   * medianoche sin depender del reloj de la máquina.
   */
  async function fijarHoraLocal(hhmm: string): Promise<void> {
    const [h, m] = hhmm.split(':').map(Number);
    const ahora = new Date();
    const utcMin = ahora.getUTCHours() * 60 + ahora.getUTCMinutes();
    let desfase = (((h * 60 + m - utcMin) % 1440) + 1440) % 1440;
    if (desfase > 720) desfase -= 1440;

    const signo = desfase >= 0 ? '-' : '+';   // invertido a propósito: ver arriba
    const abs = Math.abs(desfase);
    const zona = `${signo}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;

    await db.queryAdmin(`UPDATE tenants SET timezone = $1 WHERE id = $2`, [zona, tenantId]);

    const { rows } = await db.queryAdmin<{ local: string }>(
      `SELECT to_char(NOW() AT TIME ZONE timezone, 'HH24:MI') AS local
       FROM tenants WHERE id = $1`, [tenantId],
    );
    // Guardia: si la zona no quedó como se pretende, la prueba no prueba nada.
    expect(rows[0].local).toBe(hhmm);
  }

  it('avisa de un turno de las 00:10 cuando en el lavadero son las 23:40', async () => {
    await fijarHoraLocal('23:40');
    const id = await crearTurno(30);   // 00:10 del día local siguiente

    // Guardia: el turno quedó en otra fecha local que "hoy". Sin esto, la
    // prueba podría pasar sin cruzar nada.
    const { rows } = await db.queryAdmin<{ otro_dia: boolean }>(
      `SELECT a.scheduled_date <> (NOW() AT TIME ZONE t.timezone)::date AS otro_dia
       FROM appointments a JOIN tenants t ON t.id = a.tenant_id WHERE a.id = $1`, [id],
    );
    expect(rows[0].otro_dia).toBe(true);

    const enviar = jest.spyOn(botWa, 'enviarWhatsApp').mockResolvedValue({ enviado: true });
    await cruzandoTenants(() => sendAppointmentReminders());

    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('y dice "mañana", no "hoy"', async () => {
    await fijarHoraLocal('23:40');
    await crearTurno(30);

    const enviar = jest.spyOn(botWa, 'enviarWhatsApp').mockResolvedValue({ enviado: true });
    await cruzandoTenants(() => sendAppointmentReminders());

    const [, mensaje] = enviar.mock.calls[0];
    expect(mensaje).toContain('mañana');
    expect(mensaje).not.toContain('es hoy');
  });

  it('a las 23:40 un turno de las 23:50 no se avisa: está fuera de la ventana', async () => {
    // El otro lado: que el arreglo no se haya vuelto tan laxo que avise de todo
    // lo que queda antes de medianoche.
    await fijarHoraLocal('23:40');
    await crearTurno(10);

    const enviar = jest.spyOn(botWa, 'enviarWhatsApp').mockResolvedValue({ enviado: true });
    await cruzandoTenants(() => sendAppointmentReminders());

    expect(enviar).not.toHaveBeenCalled();
  });

  it('pasada la medianoche, un turno de las 00:35 sí se avisa a las 00:05', async () => {
    await fijarHoraLocal('00:05');
    await crearTurno(30);

    const enviar = jest.spyOn(botWa, 'enviarWhatsApp').mockResolvedValue({ enviado: true });
    await cruzandoTenants(() => sendAppointmentReminders());

    expect(enviar).toHaveBeenCalledTimes(1);
    const [, mensaje] = enviar.mock.calls[0];
    expect(mensaje).toContain('hoy');
  });
});

describe('recordatorios de turno', () => {
  it('avisa al cliente identificado sólo por LID', async () => {
    await crearTurno(30);
    const enviar = jest.spyOn(botWa, 'enviarWhatsApp').mockResolvedValue({ enviado: true });

    await cruzandoTenants(() => sendAppointmentReminders());

    expect(enviar).toHaveBeenCalledTimes(1);
    const [destino, mensaje] = enviar.mock.calls[0];
    expect(destino).toBe(LID);              // se envía al LID, no a un teléfono
    expect(mensaje).toMatch(/Recordatorio/);
    expect(mensaje).toContain('REM123');
    expect(mensaje).toContain('Diego');
  });

  it('no manda dos veces el mismo turno', async () => {
    await crearTurno(30);
    const enviar = jest.spyOn(botWa, 'enviarWhatsApp').mockResolvedValue({ enviado: true });

    await cruzandoTenants(() => sendAppointmentReminders());
    await cruzandoTenants(() => sendAppointmentReminders());   // el cron corre cada 5 min

    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('ignora turnos fuera de la ventana de 25-35 minutos', async () => {
    await crearTurno(120);
    const enviar = jest.spyOn(botWa, 'enviarWhatsApp').mockResolvedValue({ enviado: true });

    await cruzandoTenants(() => sendAppointmentReminders());

    expect(enviar).not.toHaveBeenCalled();
  });

  it('si el envío falla no lo marca como avisado, para reintentar', async () => {
    await crearTurno(30);
    const enviar = jest
      .spyOn(botWa, 'enviarWhatsApp')
      .mockResolvedValueOnce({ enviado: false, motivo: 'bot-wa 503' })
      .mockResolvedValueOnce({ enviado: true });

    await cruzandoTenants(() => sendAppointmentReminders());
    const { rows: tras1 } = await db.queryAdmin(
      `SELECT 1 FROM whatsapp_messages WHERE wa_lid = $1`, [LID],
    );
    expect(tras1).toHaveLength(0);   // nada registrado: el aviso no llegó

    await cruzandoTenants(() => sendAppointmentReminders());
    expect(enviar).toHaveBeenCalledTimes(2);
    const { rows: tras2 } = await db.queryAdmin(
      `SELECT 1 FROM whatsapp_messages WHERE wa_lid = $1`, [LID],
    );
    expect(tras2).toHaveLength(1);
  });

  it('deja el aviso en la auditoría', async () => {
    await crearTurno(30);
    jest.spyOn(botWa, 'enviarWhatsApp').mockResolvedValue({ enviado: true });

    await cruzandoTenants(() => sendAppointmentReminders());

    const { rows } = await db.queryAdmin<{ direction: string; flow_step: string; external_id: string }>(
      `SELECT direction, flow_step, external_id FROM whatsapp_messages WHERE wa_lid = $1`, [LID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe('outbound');
    expect(rows[0].flow_step).toBe('notification:reminder');
    expect(rows[0].external_id).toMatch(/^reminder:/);
  });
});
