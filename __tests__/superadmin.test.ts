/**
 * El módulo `superadmin`, que no tenía ni una prueba.
 *
 * Es el que más poder concentra —ve todos los lavaderos, les cambia el plan y
 * los puede desactivar— y es **uno de los tres bypasses deliberados de RLS**. O
 * sea que acá el aislamiento entre lavaderos no lo sostiene el motor: lo
 * sostiene una sola línea, `authorize('super_admin')`. Si esa línea se cayera,
 * cualquier admin de cualquier lavadero vería y tocaría los datos de todos, y
 * nada más lo impediría.
 *
 * Ocho rutas y cero pruebas. Eso se descubrió contando, no leyendo.
 *
 * Lo que se prueba, en orden de lo que importa:
 *
 * 1. Que un admin normal **no llegue a ninguna** de las ocho.
 * 2. Que desactivar un lavadero lo desactive de verdad.
 * 3. Que el bypass funcione, que es lo que hace útil al módulo.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';
import { hashPassword } from '../src/shared/utils/password';

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL!;
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD!;
const ADMIN_EMAIL = 'admin@elbrillante.co';
const ADMIN_PASSWORD = 'admin123';

/** Las ocho rutas, con el método con el que se llaman. */
const RUTAS: { metodo: 'get' | 'patch' | 'put'; ruta: (t: string) => string }[] = [
  { metodo: 'get', ruta: () => '/api/superadmin/dashboard' },
  { metodo: 'get', ruta: () => '/api/superadmin/tenants' },
  { metodo: 'get', ruta: (t) => `/api/superadmin/tenants/${t}` },
  { metodo: 'patch', ruta: (t) => `/api/superadmin/tenants/${t}` },
  { metodo: 'patch', ruta: (t) => `/api/superadmin/tenants/${t}/plan` },
  { metodo: 'patch', ruta: (t) => `/api/superadmin/tenants/${t}/toggle` },
  { metodo: 'get', ruta: () => '/api/superadmin/plans' },
  { metodo: 'put', ruta: () => '/api/superadmin/plans/free' },
];

function entrar(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}

let tenantId = '';
let loCreamosNosotros = false;

beforeAll(async () => {
  const { rows } = await db.queryAdmin<{ id: string }>(
    "SELECT id FROM tenants WHERE slug = 'el-brillante' LIMIT 1",
  );
  if (rows.length === 0) throw new Error('Falta el tenant del seed: ¿corriste npm run db:seed?');
  tenantId = rows[0].id;

  // `db:reset` no siembra el superadministrador —es un script aparte— así que
  // la suite lo crea si falta y lo borra al terminar.
  const { rows: sa } = await db.queryAdmin<{ id: string }>(
    "SELECT id FROM users WHERE email = $1 AND role = 'super_admin'",
    [SUPER_EMAIL],
  );
  if (sa.length === 0) {
    await db.queryAdmin(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
       VALUES (NULL, $1, $2, 'Super', 'Admin', 'super_admin')`,
      [SUPER_EMAIL, await hashPassword(SUPER_PASSWORD)],
    );
    loCreamosNosotros = true;
  }
});

afterAll(async () => {
  // Dejar el lavadero activo pase lo que pase: una prueba que se caiga a mitad
  // con el tenant desactivado rompe **todas** las suites siguientes, y el
  // síntoma —403 en todo— no señalaría para nada a este archivo.
  await db.queryAdmin('UPDATE tenants SET is_active = true WHERE id = $1', [tenantId]);
  if (loCreamosNosotros) {
    await db.queryAdmin(
      'DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)',
      [SUPER_EMAIL],
    );
    await db.queryAdmin('DELETE FROM users WHERE email = $1', [SUPER_EMAIL]);
  }
  await db.pool.end();
});

describe('quién puede entrar acá', () => {
  it('un admin de lavadero no llega a ninguna de las ocho rutas', async () => {
    // La prueba que más importa del archivo. Acá RLS está deliberadamente
    // apagado, así que esta comprobación es lo único que separa a un lavadero
    // de los datos de todos los demás.
    const login = await entrar(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(login.status).toBe(200);
    const token = login.body.accessToken as string;

    for (const { metodo, ruta } of RUTAS) {
      const res = await request(app)[metodo](ruta(tenantId))
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect([res.status, ruta(tenantId)]).toEqual([403, ruta(tenantId)]);
    }
  });

  it('sin sesión tampoco', async () => {
    for (const { metodo, ruta } of RUTAS) {
      const res = await request(app)[metodo](ruta(tenantId)).send({});
      expect([res.status, ruta(tenantId)]).toEqual([401, ruta(tenantId)]);
    }
  });
});

describe('el bypass de RLS, que es para lo que existe el módulo', () => {
  it('el superadministrador ve los lavaderos y sus números', async () => {
    // Sin el bypass esto devolvería vacío con RLS aplicándose: el
    // superadministrador no tiene tenant, así que `app.tenant_id` queda sin
    // fijar y las políticas fallan cerrado. Que traiga filas **es** la prueba
    // de que el bypass está puesto.
    const login = await entrar(SUPER_EMAIL, SUPER_PASSWORD);
    const token = login.body.accessToken as string;

    const tenants = await request(app)
      .get('/api/superadmin/tenants')
      .set('Authorization', `Bearer ${token}`);
    expect(tenants.status).toBe(200);
    expect(tenants.body.data.length).toBeGreaterThan(0);

    const dashboard = await request(app)
      .get('/api/superadmin/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.overview.activeTenants).toBeGreaterThan(0);
  });
});

describe('desactivar un lavadero', () => {
  afterEach(async () => {
    await db.queryAdmin('UPDATE tenants SET is_active = true WHERE id = $1', [tenantId]);
  });

  it('le impide entrar a su gente', async () => {
    await db.queryAdmin('UPDATE tenants SET is_active = false WHERE id = $1', [tenantId]);

    const login = await entrar(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(login.status).toBe(403);
    expect(login.body.error).toMatch(/desactivada/i);
  });

  it('y también le corta la sesión que ya tenía abierta', async () => {
    // Esto es lo que faltaba. El login comprobaba el lavadero y el refresh no,
    // así que desactivar uno sólo frenaba a quien **todavía no había entrado**:
    // los que ya estaban adentro renovaban indefinidamente —el refresh dura
    // siete días y rota en cada uso— y la suspensión no les llegaba nunca.
    //
    // Justo la población que se quiere frenar al suspender por falta de pago.
    const login = await entrar(ADMIN_EMAIL, ADMIN_PASSWORD);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((c) => c.startsWith('refresh_token='))!.split(';')[0];

    await db.queryAdmin('UPDATE tenants SET is_active = false WHERE id = $1', [tenantId]);

    const renovar = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refresh)
      .set('x-panel-request', '1')
      .send({});

    expect(renovar.status).toBe(403);
    expect(renovar.body.error).toMatch(/desactivada/i);
  });

  it('el superadministrador sigue entrando: no tiene lavadero', async () => {
    // El `LEFT JOIN` del refresh deja `tenant_activo` en NULL para él, y NULL no
    // es `false`. Si esa distinción se perdiera, desactivar cualquier lavadero
    // dejaría afuera a quien tiene que arreglarlo.
    await db.queryAdmin('UPDATE tenants SET is_active = false WHERE id = $1', [tenantId]);

    const login = await entrar(SUPER_EMAIL, SUPER_PASSWORD);
    expect(login.status).toBe(200);

    const cookies = login.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((c) => c.startsWith('refresh_token='))!.split(';')[0];

    const renovar = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refresh)
      .set('x-panel-request', '1')
      .send({});

    expect(renovar.status).toBe(200);
  });

  it('reactivarlo lo devuelve a la normalidad', async () => {
    const login = await entrar(SUPER_EMAIL, SUPER_PASSWORD);
    const token = login.body.accessToken as string;

    await db.queryAdmin('UPDATE tenants SET is_active = false WHERE id = $1', [tenantId]);
    expect((await entrar(ADMIN_EMAIL, ADMIN_PASSWORD)).status).toBe(403);

    const toggle = await request(app)
      .patch(`/api/superadmin/tenants/${tenantId}/toggle`)
      .set('Authorization', `Bearer ${token}`);
    expect(toggle.status).toBe(200);

    expect((await entrar(ADMIN_EMAIL, ADMIN_PASSWORD)).status).toBe(200);
  });
});
