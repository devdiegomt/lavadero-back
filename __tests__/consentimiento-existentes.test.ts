/**
 * La autorización también se le pide al cliente que ya existía.
 *
 * Los clientes creados antes de que el flujo pidiera autorización quedaron con
 * `consent_at` en NULL. Se había anotado como «pasivo a regularizar, proceso y
 * no código», y esa lectura era incompleta: la consulta que busca el vehículo
 * ni siquiera miraba `consent_at`, así que al volver, el flujo los reconocía
 * por la placa y **agendaba de nuevo sin pedírsela nunca**.
 *
 * No era un pasivo quieto: se volvía a ejercer en cada visita.
 */
import * as db from '../src/shared/db';
import { conTenant } from './helpers/rls';
import { registrarAutorizacion } from '../src/modules/whatsapp/wa-identity';
import { VERSION_AVISO, autorizacionDe } from '../src/modules/whatsapp/consentimiento';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const booking = require('../src/modules/whatsapp/flows/booking');

const PLACA_SIN = 'EXI001';
const PLACA_CON = 'EXI002';

let tenant: { id: string; name: string };

/**
 * Corre la prueba dentro del contexto de tenant, como lo haría una petición.
 * Con RLS activo, llamar estas funciones sin contexto no ve ninguna fila: las
 * políticas fallan cerrado a propósito. Ver helpers/rls.ts.
 */
const itEnTenant = (nombre: string, fn: () => Promise<void>): void => {
  it(nombre, () => conTenant(tenant.id, fn));
};


/** Crea un cliente con vehículo, con o sin autorización registrada. */
async function crearClienteConVehiculo(
  nombre: string, placa: string, conAutorizacion: boolean,
): Promise<string> {
  const { rows } = await db.queryAdmin<{ id: string }>(
    `INSERT INTO customers (tenant_id, first_name, phone, consent_at, consent_version, consent_source)
     VALUES ($1, $2, $3, ${conAutorizacion ? 'NOW()' : 'NULL'},
             ${conAutorizacion ? `'${VERSION_AVISO}'` : 'NULL'},
             ${conAutorizacion ? "'whatsapp'" : 'NULL'})
     RETURNING id`,
    [tenant.id, nombre, `+5730011${placa.slice(-4)}`],
  );
  await db.queryAdmin(
    `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type)
     VALUES ($1, $2, $3, 'sedan')`,
    [tenant.id, rows[0].id, placa],
  );
  return rows[0].id;
}

/** El paso de la placa, que es donde se decide si hace falta pedirla. */
function darLaPlaca(placa: string) {
  return booking.handle({
    tenant,
    waLid: '99966600011122@lid',
    text: placa,
    session: { step: 'awaiting_plate', data: {} },
  });
}

async function consentDe(customerId: string) {
  const { rows } = await db.queryAdmin<{ consent_at: Date | null; consent_version: string | null }>(
    `SELECT consent_at, consent_version FROM customers WHERE id = $1`, [customerId],
  );
  return rows[0];
}

beforeAll(async () => {
  const { rows } = await db.queryAdmin<{ id: string; name: string }>(
    `SELECT id, name FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenant = rows[0];
});

beforeEach(async () => {
  await db.queryAdmin(
    `DELETE FROM vehicles WHERE tenant_id = $1 AND plate IN ($2, $3)`,
    [tenant.id, PLACA_SIN, PLACA_CON],
  );
  await db.queryAdmin(
    `DELETE FROM customers WHERE tenant_id = $1 AND first_name IN ('Viejo', 'Autorizado')`,
    [tenant.id],
  );
});

afterAll(async () => {
  await db.queryAdmin(
    `DELETE FROM vehicles WHERE tenant_id = $1 AND plate IN ($2, $3)`,
    [tenant.id, PLACA_SIN, PLACA_CON],
  );
  await db.queryAdmin(
    `DELETE FROM customers WHERE tenant_id = $1 AND first_name IN ('Viejo', 'Autorizado')`,
    [tenant.id],
  );
  await db.pool.end();
});

describe('cliente conocido sin autorización registrada', () => {
  itEnTenant('se le pide antes de dejarle agendar', async () => {
    await crearClienteConVehiculo('Viejo', PLACA_SIN, false);

    const r = await darLaPlaca(PLACA_SIN);

    // Antes iba directo a elegir servicio y agendaba sin autorización.
    expect(r.nextStep).toBe('awaiting_consent_existente');
    expect(r.messages.join('\n')).toContain('¿Autorizas el tratamiento');
  });

  itEnTenant('al aceptar queda registrada en su ficha y sigue al servicio', async () => {
    const id = await crearClienteConVehiculo('Viejo', PLACA_SIN, false);
    const paso1 = await darLaPlaca(PLACA_SIN);

    const r = await booking.handle({
      tenant,
      waLid: '99966600011122@lid',
      text: 'SI',
      session: { step: 'awaiting_consent_existente', data: paso1.data },
    });

    expect(r.nextStep).toBe('awaiting_service');

    const c = await consentDe(id);
    expect(c.consent_at).toBeInstanceOf(Date);
    expect(c.consent_version).toBe(VERSION_AVISO);
  });

  itEnTenant('si no autoriza, no agenda y no se le registra nada', async () => {
    const id = await crearClienteConVehiculo('Viejo', PLACA_SIN, false);
    const paso1 = await darLaPlaca(PLACA_SIN);

    const r = await booking.handle({
      tenant,
      waLid: '99966600011122@lid',
      text: 'no',
      session: { step: 'awaiting_consent_existente', data: paso1.data },
    });

    expect(r.nextFlow).toBeNull();
    expect((await consentDe(id)).consent_at).toBeNull();
  });

  itEnTenant('ante una respuesta ambigua repregunta, sin darla por concedida', async () => {
    const id = await crearClienteConVehiculo('Viejo', PLACA_SIN, false);
    const paso1 = await darLaPlaca(PLACA_SIN);

    const r = await booking.handle({
      tenant,
      waLid: '99966600011122@lid',
      text: 'y cuánto sale',
      session: { step: 'awaiting_consent_existente', data: paso1.data },
    });

    expect(r.nextStep).toBe('awaiting_consent_existente');
    expect((await consentDe(id)).consent_at).toBeNull();
  });
});

describe('a quien ya autorizó no se le vuelve a preguntar', () => {
  itEnTenant('va directo a elegir servicio', async () => {
    await crearClienteConVehiculo('Autorizado', PLACA_CON, true);

    const r = await darLaPlaca(PLACA_CON);

    expect(r.nextStep).toBe('awaiting_service');
  });
});

describe('registrarAutorizacion', () => {
  itEnTenant('no pisa una autorización anterior', async () => {
    // La fecha y la versión originales son la prueba de qué se le informó y
    // cuándo. Sobrescribirlas destruiría justo lo que hay que poder mostrar.
    const id = await crearClienteConVehiculo('Autorizado', PLACA_CON, true);
    const antes = await consentDe(id);

    const escribio = await registrarAutorizacion(
      tenant.id, id, { ...autorizacionDe('panel'), consentVersion: 'otra-version' },
    );

    expect(escribio).toBe(false);
    const despues = await consentDe(id);
    expect(despues.consent_version).toBe(antes.consent_version);
    expect(despues.consent_at).toEqual(antes.consent_at);
  });

  itEnTenant('no alcanza a un cliente de otro lavadero', async () => {
    const id = await crearClienteConVehiculo('Viejo', PLACA_SIN, false);
    const otroTenant = '00000000-0000-0000-0000-000000000000';

    expect(await registrarAutorizacion(otroTenant, id, autorizacionDe('panel'))).toBe(false);
    expect((await consentDe(id)).consent_at).toBeNull();
  });
});
