/**
 * Recordatorios de turno.
 *
 * El bot promete "te avisamos 30 min antes" al confirmar. Esa promesa no se
 * cumplía por tres razones a la vez: la función no estaba registrada en el
 * cron, enviaba por Twilio en vez de bot-wa, y exigía c.phone —que es NULL
 * para quien llega por WhatsApp, porque el número no lo entrega.
 */
import * as db from '../src/shared/db';
import * as botWa from '../src/modules/whatsapp/bot-wa.client';
import { sendAppointmentReminders } from '../src/modules/whatsapp/notifications';

const LID = 'REM' + Date.now() + '@lid';
let tenantId: string;
let customerId: string;
let vehicleId: string;
let serviceId: string;

/** Crea un turno a `minutos` de ahora, en la zona horaria del tenant. */
async function crearTurno(minutos: number): Promise<string> {
  const { rows } = await db.query<{ hora: string; dia: string }>(
    `SELECT to_char((NOW() AT TIME ZONE t.timezone) + ($2 || ' minutes')::interval, 'HH24:MI') AS hora,
            to_char((NOW() AT TIME ZONE t.timezone), 'YYYY-MM-DD') AS dia
     FROM tenants t WHERE t.id = $1`,
    [tenantId, String(minutos)],
  );
  const { rows: appt } = await db.query<{ id: string }>(
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
  const { rows: t } = await db.query<{ id: string }>(
    `UPDATE tenants SET whatsapp_enabled = true WHERE slug = 'el-brillante' RETURNING id`,
  );
  tenantId = t[0].id;

  // Cliente identificado sólo por LID: el caso real.
  const { rows: c } = await db.query<{ id: string }>(
    `INSERT INTO customers (tenant_id, first_name, wa_lid) VALUES ($1, 'Diego', $2) RETURNING id`,
    [tenantId, LID],
  );
  customerId = c[0].id;

  const { rows: v } = await db.query<{ id: string }>(
    `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type)
     VALUES ($1, $2, 'REM123', 'sedan') RETURNING id`,
    [tenantId, customerId],
  );
  vehicleId = v[0].id;

  const { rows: s } = await db.query<{ id: string }>(
    `SELECT id FROM services WHERE tenant_id = $1 LIMIT 1`, [tenantId],
  );
  serviceId = s[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM whatsapp_messages WHERE wa_lid = $1`, [LID]);
  await db.query(`DELETE FROM appointments WHERE customer_id = $1`, [customerId]);
  await db.query(`DELETE FROM vehicles WHERE customer_id = $1`, [customerId]);
  await db.query(`DELETE FROM customers WHERE id = $1`, [customerId]);
  await db.pool.end();
});

beforeEach(async () => {
  await db.query(`DELETE FROM whatsapp_messages WHERE wa_lid = $1`, [LID]);
  await db.query(`DELETE FROM appointments WHERE customer_id = $1`, [customerId]);
  jest.restoreAllMocks();
});

describe('recordatorios de turno', () => {
  it('avisa al cliente identificado sólo por LID', async () => {
    await crearTurno(30);
    const enviar = jest.spyOn(botWa, 'enviarWhatsApp').mockResolvedValue({ enviado: true });

    await sendAppointmentReminders();

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

    await sendAppointmentReminders();
    await sendAppointmentReminders();   // el cron corre cada 5 min

    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('ignora turnos fuera de la ventana de 25-35 minutos', async () => {
    await crearTurno(120);
    const enviar = jest.spyOn(botWa, 'enviarWhatsApp').mockResolvedValue({ enviado: true });

    await sendAppointmentReminders();

    expect(enviar).not.toHaveBeenCalled();
  });

  it('si el envío falla no lo marca como avisado, para reintentar', async () => {
    await crearTurno(30);
    const enviar = jest
      .spyOn(botWa, 'enviarWhatsApp')
      .mockResolvedValueOnce({ enviado: false, motivo: 'bot-wa 503' })
      .mockResolvedValueOnce({ enviado: true });

    await sendAppointmentReminders();
    const { rows: tras1 } = await db.query(
      `SELECT 1 FROM whatsapp_messages WHERE wa_lid = $1`, [LID],
    );
    expect(tras1).toHaveLength(0);   // nada registrado: el aviso no llegó

    await sendAppointmentReminders();
    expect(enviar).toHaveBeenCalledTimes(2);
    const { rows: tras2 } = await db.query(
      `SELECT 1 FROM whatsapp_messages WHERE wa_lid = $1`, [LID],
    );
    expect(tras2).toHaveLength(1);
  });

  it('deja el aviso en la auditoría', async () => {
    await crearTurno(30);
    jest.spyOn(botWa, 'enviarWhatsApp').mockResolvedValue({ enviado: true });

    await sendAppointmentReminders();

    const { rows } = await db.query<{ direction: string; flow_step: string; external_id: string }>(
      `SELECT direction, flow_step, external_id FROM whatsapp_messages WHERE wa_lid = $1`, [LID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe('outbound');
    expect(rows[0].flow_step).toBe('notification:reminder');
    expect(rows[0].external_id).toMatch(/^reminder:/);
  });
});
