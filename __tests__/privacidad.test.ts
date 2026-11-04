/**
 * La autorización de datos cuando el cliente se crea desde el panel, y el
 * contacto público del lavadero para su aviso de privacidad.
 *
 * Hasta acá sólo el bot de WhatsApp pedía la autorización. Un cliente creado
 * por un operario desde el panel —que es como trabaja un lavadero mientras el
 * bot no está activo— quedaba con `consent_at` vacío: sin la autorización
 * previa que la Ley 1581 pone primero. Ver docs/05-seguridad.md §5.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';
import { VERSION_AVISO_LAVADERO } from '../src/modules/whatsapp/consentimiento';

let token: string;
let serviceId: string;
let tenantId: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

// Teléfonos y placas propios, para limpiar sin tocar lo de otras suites.
const TEL = { nuevo: '+573117770001', rapido: '+573117770002', sinAut: '+573117770003', conAut: '+573117770004' };
const PLACAS = ['PRV001', 'PRV002', 'PRV003', 'PRV004'];

async function limpiar(): Promise<void> {
  const tels = Object.values(TEL);
  await db.queryAdmin(
    `DELETE FROM appointments WHERE customer_id IN (SELECT id FROM customers WHERE phone = ANY($1))`,
    [tels],
  );
  await db.queryAdmin(`DELETE FROM vehicles WHERE UPPER(plate) = ANY($1)`, [PLACAS]);
  await db.queryAdmin(`DELETE FROM customers WHERE phone = ANY($1)`, [tels]);
}

beforeAll(async () => {
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@elbrillante.co', password: 'admin123' });
  expect([login.status, 'login']).toEqual([200, 'login']);
  token = login.body.accessToken;
  tenantId = login.body.user.tenantId ?? login.body.user.tenant?.id;
  const svc = await request(app).get('/api/services').set(auth());
  serviceId = svc.body[0].id;
  await limpiar();
});

afterAll(async () => {
  await limpiar();
  await db.pool.end();
});

const autorizacion = async (telefono: string) =>
  (
    await db.queryAdmin<{ consent_at: Date | null; consent_version: string | null; consent_source: string | null }>(
      'SELECT consent_at, consent_version, consent_source FROM customers WHERE phone = $1',
      [telefono],
    )
  ).rows;

describe('crear un cliente desde el panel', () => {
  it('sin la autorización no se crea, y el mensaje dice qué falta', async () => {
    const res = await request(app).post('/api/customers').set(auth()).send({ firstName: 'Sin', phone: TEL.nuevo });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/autorización/);
    expect(await autorizacion(TEL.nuevo)).toHaveLength(0);
  });

  it('con la autorización, queda registrada con fecha, versión del aviso y canal', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set(auth())
      .send({ autorizaDatos: true, firstName: 'Con', phone: TEL.nuevo });
    expect(res.status).toBe(201);
    const [fila] = await autorizacion(TEL.nuevo);
    expect(fila.consent_at).not.toBeNull();
    expect(fila.consent_version).toBe(VERSION_AVISO_LAVADERO);
    expect(fila.consent_source).toBe('panel');
  });
});

describe('turno rápido', () => {
  const turno = (telefono: string, placa: string, extra: object = {}) =>
    request(app)
      .post('/api/appointments/quick')
      .set(auth())
      .send({ customerPhone: telefono, customerFirstName: 'Rápido', plate: placa, serviceId, ...extra });

  it('con un cliente nuevo y sin autorización, no crea nada', async () => {
    const res = await turno(TEL.rapido, PLACAS[1]);
    expect(res.status).toBe(400);
    expect(res.body.details?.codigo).toBe('FALTA_AUTORIZACION');
    expect(await autorizacion(TEL.rapido)).toHaveLength(0);
  });

  it('con la autorización, crea el cliente con ella', async () => {
    const res = await turno(TEL.rapido, PLACAS[1], { autorizaDatos: true });
    expect(res.status).toBe(201);
    const [fila] = await autorizacion(TEL.rapido);
    expect(fila.consent_source).toBe('panel');
  });

  it('un cliente que ya existía sin autorización también la necesita, una vez', async () => {
    await db.queryAdmin(
      `INSERT INTO customers (tenant_id, first_name, phone) VALUES ($1, 'Viejo', $2)`,
      [tenantId, TEL.sinAut],
    );
    expect((await turno(TEL.sinAut, PLACAS[2])).status).toBe(400);
    expect((await turno(TEL.sinAut, PLACAS[2], { autorizaDatos: true })).status).toBe(201);
    expect((await autorizacion(TEL.sinAut))[0].consent_source).toBe('panel');
  });

  it('a un cliente que ya autorizó no se le vuelve a pedir, ni se pisa la fecha original', async () => {
    const original = new Date('2026-09-15T10:00:00Z');
    await db.queryAdmin(
      `INSERT INTO customers (tenant_id, first_name, phone, consent_at, consent_version, consent_source)
       VALUES ($1, 'Autorizó', $2, $3, '2026-09-v1', 'whatsapp')`,
      [tenantId, TEL.conAut, original],
    );
    expect((await turno(TEL.conAut, PLACAS[3])).status).toBe(201);
    const [fila] = await autorizacion(TEL.conAut);
    expect(new Date(fila.consent_at as Date).toISOString()).toBe(original.toISOString());
    expect(fila.consent_source).toBe('whatsapp');
  });

  it('buscar por placa dice si el dueño ya autorizó, para que el panel sepa si preguntar', async () => {
    const res = await request(app).get(`/api/vehicles/plate/${PLACAS[3]}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.customer_consent_at).not.toBeNull();
  });
});

describe('el contacto público del lavadero', () => {
  it('se lee sin sesión, y trae sólo los datos del negocio', async () => {
    const res = await request(app).get('/api/publico/lavaderos/el-brillante');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['ciudad', 'correo', 'direccion', 'nit', 'nombre', 'razonSocial', 'telefono'].sort(),
    );
    expect(res.body.nombre).toBe('Lavadero El Brillante');
  });

  it('un slug que no existe da 404, y uno con caracteres raros ni llega a la base', async () => {
    expect((await request(app).get('/api/publico/lavaderos/no-existe-este')).status).toBe(404);
    expect((await request(app).get(`/api/publico/lavaderos/${encodeURIComponent("x' OR 1=1 --")}`)).status).toBe(404);
  });

  it('un lavadero desactivado no aparece', async () => {
    await db.queryAdmin(`UPDATE tenants SET is_active = false WHERE slug = 'el-brillante'`);
    try {
      expect((await request(app).get('/api/publico/lavaderos/el-brillante')).status).toBe(404);
    } finally {
      await db.queryAdmin(`UPDATE tenants SET is_active = true WHERE slug = 'el-brillante'`);
    }
  });
});

describe('registrar un lavadero', () => {
  const correo = `politica-${Date.now()}@ejemplo.co`;
  const registro = (extra: object) =>
    request(app).post('/api/onboarding/register').send({
      businessName: 'Lavadero Política',
      phone: '3006665544',
      openingTime: '08:00',
      closingTime: '18:00',
      adminEmail: correo,
      adminPassword: 'Segura123',
      adminFirstName: 'Dueño',
      ...extra,
    });

  afterAll(async () => {
    const { rows } = await db.queryAdmin<{ tenant_id: string }>('SELECT tenant_id FROM users WHERE email = $1', [correo]);
    await db.queryAdmin('DELETE FROM users WHERE email = $1', [correo]);
    if (rows[0]) {
      await db.queryAdmin('DELETE FROM onboarding_log WHERE tenant_id = $1', [rows[0].tenant_id]);
      await db.queryAdmin('DELETE FROM tenants WHERE id = $1', [rows[0].tenant_id]);
    }
  });

  it('sin aceptar la política de Qlarity no se crea la cuenta', async () => {
    const res = await registro({});
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/política de tratamiento/);
  });

  it('aceptándola, queda registrado qué versión aceptó y cuándo', async () => {
    const res = await registro({ aceptaPolitica: true });
    expect(res.status).toBe(201);
    const { rows } = await db.queryAdmin<{ metadata: { version: string; aceptadaEn: string } }>(
      `SELECT metadata FROM onboarding_log WHERE tenant_id = $1 AND step = 'politica_aceptada'`,
      [res.body.tenant.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.version).toBe('2026-11-v1');
    expect(rows[0].metadata.aceptadaEn).toBeTruthy();
  });
});
