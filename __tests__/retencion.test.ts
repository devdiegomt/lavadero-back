/**
 * Retención de datos personales (Ley 1581 de 2012).
 *
 * La ley pide conservar los datos sólo mientras la finalidad lo justifique, y
 * atender la supresión cuando el titular la pide. Lo que se prueba acá es que
 * las dos cosas efectivamente borran el dato personal y —esto importa igual—
 * que no borran de más: los turnos son historial de negocio, no dato personal,
 * y tienen que sobrevivir a la anonimización.
 */
import * as db from '../src/shared/db';
import {
  purgarMensajesViejos,
  anonimizarClientesInactivos,
  anonimizarCliente,
  clientesSinAutorizacion,
} from '../src/shared/db/retencion';

const LID_VIEJO = '99900022211100@lid';
const LID_RECIENTE = '99900022211111@lid';
const LID_SUPRESION = '99900022211122@lid';
const MARCA = '[test-retencion]';

let tenantId: string;
let serviceId: string;

/** Crea un cliente con una última visita puesta N meses atrás. */
async function crearCliente(lid: string, mesesInactivo: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO customers
       (tenant_id, first_name, last_name, phone, email, document_number, notes,
        wa_lid, last_visit_at, consent_at, consent_version, consent_source)
     VALUES ($1, 'Titular', 'De Prueba', '+573001110000', 'titular@example.com',
             '1234567890', 'nota con dato personal', $2,
             NOW() - ($3 || ' months')::interval, NOW(), '2026-09-v1', 'whatsapp')
     RETURNING id`,
    [tenantId, lid, String(mesesInactivo)],
  );
  return rows[0].id;
}

beforeAll(async () => {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenantId = rows[0].id;

  const { rows: srv } = await db.query<{ id: string }>(
    `SELECT id FROM services WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  serviceId = srv[0].id;
});

afterEach(async () => {
  await db.query(`DELETE FROM whatsapp_messages WHERE content LIKE $1`, [`${MARCA}%`]);
});

afterAll(async () => {
  await db.query(
    `DELETE FROM appointments WHERE customer_id IN
       (SELECT id FROM customers WHERE tenant_id = $1 AND notes = 'nota con dato personal'
          OR (tenant_id = $1 AND first_name = 'Cliente' AND wa_lid IS NULL AND phone IS NULL
              AND anonymized_at IS NOT NULL))`,
    [tenantId],
  );
  await db.query(`DELETE FROM customers WHERE tenant_id = $1 AND anonymized_at IS NOT NULL`, [
    tenantId,
  ]);
  await db.query(`DELETE FROM customers WHERE tenant_id = $1 AND wa_lid IN ($2, $3, $4)`, [
    tenantId,
    LID_VIEJO,
    LID_RECIENTE,
    LID_SUPRESION,
  ]);
  await db.query(`DELETE FROM whatsapp_messages WHERE content LIKE $1`, [`${MARCA}%`]);
  await db.pool.end();
});

describe('purga de conversaciones', () => {
  /** Inserta un mensaje fechado N meses atrás. Devuelve su id. */
  async function mensaje(mesesAtras: number): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO whatsapp_messages (tenant_id, phone, direction, content, created_at)
       VALUES ($1, '+573001110000', 'inbound', $2, NOW() - ($3 || ' months')::interval)
       RETURNING id`,
      [tenantId, `${MARCA} hola, cuánto sale el lavado`, String(mesesAtras)],
    );
    return rows[0].id;
  }

  async function existe(id: string): Promise<boolean> {
    const { rows } = await db.query(`SELECT 1 FROM whatsapp_messages WHERE id = $1`, [id]);
    return rows.length === 1;
  }

  it('borra lo que pasó el plazo y conserva lo que no', async () => {
    const viejo = await mensaje(13);
    const reciente = await mensaje(1);

    await purgarMensajesViejos(12);

    expect(await existe(viejo)).toBe(false);
    expect(await existe(reciente)).toBe(true);
  });

  it('con plazo 0 no borra nada: es la forma de desactivar la tarea', async () => {
    const viejo = await mensaje(60);

    expect(await purgarMensajesViejos(0)).toBe(0);
    expect(await existe(viejo)).toBe(true);
  });
});

describe('anonimización por inactividad', () => {
  it('borra los datos del inactivo y deja intacto al que sigue viniendo', async () => {
    const viejo = await crearCliente(LID_VIEJO, 24);
    const reciente = await crearCliente(LID_RECIENTE, 1);

    await anonimizarClientesInactivos(12);

    const { rows } = await db.query<{
      id: string;
      first_name: string;
      last_name: string | null;
      phone: string | null;
      email: string | null;
      document_number: string | null;
      notes: string | null;
      wa_lid: string | null;
      anonymized_at: Date | null;
    }>(
      `SELECT id, first_name, last_name, phone, email, document_number, notes,
              wa_lid, anonymized_at
       FROM customers WHERE id IN ($1, $2)`,
      [viejo, reciente],
    );
    const porId = Object.fromEntries(rows.map((r) => [r.id, r]));

    // Del inactivo no queda nada que identifique a una persona.
    expect(porId[viejo].first_name).toBe('Cliente');
    expect(porId[viejo].last_name).toBeNull();
    expect(porId[viejo].phone).toBeNull();
    expect(porId[viejo].email).toBeNull();
    expect(porId[viejo].document_number).toBeNull();
    expect(porId[viejo].notes).toBeNull();
    expect(porId[viejo].wa_lid).toBeNull();
    expect(porId[viejo].anonymized_at).toBeInstanceOf(Date);

    // El que sigue activo no se toca: el plazo corre desde la última visita.
    expect(porId[reciente].phone).toBe('+573001110000');
    expect(porId[reciente].anonymized_at).toBeNull();
  });

  it('con plazo 0 no anonimiza nada', async () => {
    expect(await anonimizarClientesInactivos(0)).toBe(0);
  });
});

describe('derecho de supresión', () => {
  it('anonimiza al titular sin perder sus turnos', async () => {
    const customerId = await crearCliente(LID_SUPRESION, 0);
    const { rows: veh } = await db.query<{ id: string }>(
      `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type)
       VALUES ($1, $2, 'SUP123', 'sedan') RETURNING id`,
      [tenantId, customerId],
    );
    await db.query(
      `INSERT INTO appointments
         (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, price, status)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 2500000, 'delivered')`,
      [tenantId, customerId, veh[0].id, serviceId],
    );

    expect(await anonimizarCliente(tenantId, customerId)).toBe(true);

    const { rows } = await db.query<{ phone: string | null; anonymized_at: Date | null }>(
      `SELECT phone, anonymized_at FROM customers WHERE id = $1`,
      [customerId],
    );
    expect(rows[0].phone).toBeNull();
    expect(rows[0].anonymized_at).toBeInstanceOf(Date);

    // El turno es historial de negocio, no dato personal: sigue contando para
    // las estadísticas del lavadero. Un DELETE lo habría perdido.
    const { rows: turnos } = await db.query(
      `SELECT id FROM appointments WHERE customer_id = $1`,
      [customerId],
    );
    expect(turnos).toHaveLength(1);
  });

  it('no deja que un lavadero borre el cliente de otro', async () => {
    const customerId = await crearCliente('99900022211133@lid', 0);
    const otroTenant = '00000000-0000-0000-0000-000000000000';

    expect(await anonimizarCliente(otroTenant, customerId)).toBe(false);

    const { rows } = await db.query<{ phone: string | null }>(
      `SELECT phone FROM customers WHERE id = $1`,
      [customerId],
    );
    expect(rows[0].phone).toBe('+573001110000');

    await db.query(`DELETE FROM customers WHERE id = $1`, [customerId]);
  });

  it('sobre un cliente ya anonimizado no vuelve a actuar', async () => {
    const customerId = await crearCliente('99900022211144@lid', 0);

    expect(await anonimizarCliente(tenantId, customerId)).toBe(true);
    expect(await anonimizarCliente(tenantId, customerId)).toBe(false);
  });
});

describe('pasivo de autorizaciones', () => {
  it('no cuenta a los anonimizados: ya no hay dato que regularizar', async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO customers (tenant_id, first_name, phone)
       VALUES ($1, 'Sin', '+573009998877') RETURNING id`,
      [tenantId],
    );
    const antes = await clientesSinAutorizacion(tenantId);

    await anonimizarCliente(tenantId, rows[0].id);

    expect(await clientesSinAutorizacion(tenantId)).toBe(antes - 1);
  });
});
