/**
 * `PATCH /api/auth/password` — cambiar la contraseña propia.
 *
 * Existe por un agujero que se vio recreando la base de producción: el
 * superadministrador **no podía cambiar su propia contraseña**. Todas las rutas
 * de `/api/users` van bajo `requireTenant`, y él no tiene tenant, así que
 * recibía `400 Tenant no identificado`. La cuenta con más poder del sistema era
 * la única sin forma de rotar su credencial — y el seed la creaba con una
 * contraseña escrita en el README.
 *
 * Estas pruebas dejan fijas las dos mitades: que la ruta funciona para un
 * usuario con tenant, y que **funciona para el superadministrador**, que es la
 * razón de que la ruta esté en `auth` y no en `users`.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';
import { hashPassword } from '../src/shared/utils/password';

const EMAIL = 'admin@elbrillante.co';
const PASSWORD = 'admin123';

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL!;
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD!;

function entrar(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}

/**
 * Devuelve la contraseña a su valor original.
 *
 * Escribiendo el hash directo, no por la API: si una prueba falla a mitad, la
 * siguiente suite tiene que encontrar la base como la dejó el seed. Ya pasó
 * cuatro veces que una suite dejara estado y rompiera otras sin relación
 * aparente — está anotado en la metodología.
 */
async function restaurar(email: string, password: string): Promise<void> {
  await db.queryAdmin('UPDATE users SET password_hash = $1 WHERE email = $2', [
    await hashPassword(password),
    email,
  ]);
}

/**
 * `db:reset` no siembra el superadministrador —`db:seed-superadmin` es un script
 * aparte—, así que la suite lo crea si falta y lo borra al terminar. La base
 * tiene que quedar como estaba: el estado que una suite deja es el que encuentra
 * la siguiente, y eso ya rompió cosas cuatro veces.
 */
let loCreamosNosotros = false;

beforeAll(async () => {
  const { rows } = await db.queryAdmin<{ id: string }>(
    "SELECT id FROM users WHERE email = $1 AND role = 'super_admin'",
    [SUPER_EMAIL],
  );
  if (rows.length === 0) {
    await db.queryAdmin(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
       VALUES (NULL, $1, $2, 'Super', 'Admin', 'super_admin')`,
      [SUPER_EMAIL, await hashPassword(SUPER_PASSWORD)],
    );
    loCreamosNosotros = true;
  }
});

afterAll(async () => {
  await restaurar(EMAIL, PASSWORD);
  if (loCreamosNosotros) {
    await db.queryAdmin('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [SUPER_EMAIL]);
    await db.queryAdmin('DELETE FROM users WHERE email = $1', [SUPER_EMAIL]);
  } else {
    await restaurar(SUPER_EMAIL, SUPER_PASSWORD);
  }
  await db.pool.end();
});

describe('cambiar la contraseña propia', () => {
  afterEach(async () => {
    await restaurar(EMAIL, PASSWORD);
    await restaurar(SUPER_EMAIL, SUPER_PASSWORD);
  });

  it('el superadministrador puede, que es para lo que se hizo', async () => {
    // La prueba que justifica la ruta. Por `/api/users/:id/password` esto da 400.
    const login = await entrar(SUPER_EMAIL, SUPER_PASSWORD);
    expect(login.status).toBe(200);

    const cambio = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${login.body.accessToken as string}`)
      .send({ currentPassword: SUPER_PASSWORD, newPassword: 'otra-bien-larga-1' });

    expect(cambio.status).toBe(200);

    // La nueva sirve y la vieja no.
    expect((await entrar(SUPER_EMAIL, 'otra-bien-larga-1')).status).toBe(200);
    expect((await entrar(SUPER_EMAIL, SUPER_PASSWORD)).status).toBe(401);
  });

  it('la ruta vieja de users NO le sirve al superadministrador', async () => {
    // Deja constancia de por qué hizo falta una ruta nueva en vez de reusar
    // aquella. Si algún día `users` deja de exigir tenant, esto lo avisa.
    const login = await entrar(SUPER_EMAIL, SUPER_PASSWORD);
    const { rows } = await db.queryAdmin<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [SUPER_EMAIL],
    );

    const intento = await request(app)
      .patch(`/api/users/${rows[0].id}/password`)
      .set('Authorization', `Bearer ${login.body.accessToken as string}`)
      .send({ currentPassword: SUPER_PASSWORD, newPassword: 'otra-bien-larga-1' });

    expect(intento.status).toBe(400);
    expect(intento.body.error).toMatch(/tenant/i);
  });

  it('un usuario con tenant también puede', async () => {
    const login = await entrar(EMAIL, PASSWORD);

    const cambio = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${login.body.accessToken as string}`)
      .send({ currentPassword: PASSWORD, newPassword: 'otra-bien-larga-2' });

    expect(cambio.status).toBe(200);
    expect((await entrar(EMAIL, 'otra-bien-larga-2')).status).toBe(200);
  });

  it('la contraseña actual equivocada no cambia nada', async () => {
    const login = await entrar(EMAIL, PASSWORD);

    const cambio = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${login.body.accessToken as string}`)
      .send({ currentPassword: 'no-es-esta', newPassword: 'otra-bien-larga-2' });

    expect(cambio.status).toBe(400);
    // Y la de verdad sigue sirviendo.
    expect((await entrar(EMAIL, PASSWORD)).status).toBe(200);
  });

  it('no deja repetir la contraseña que ya tenía', async () => {
    const login = await entrar(EMAIL, PASSWORD);

    const cambio = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${login.body.accessToken as string}`)
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD });

    expect(cambio.status).toBe(400);
  });

  it('una contraseña corta se rechaza antes de tocar la base', async () => {
    const login = await entrar(EMAIL, PASSWORD);

    const cambio = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${login.body.accessToken as string}`)
      .send({ currentPassword: PASSWORD, newPassword: 'corta' });

    expect(cambio.status).toBe(400);
    expect((await entrar(EMAIL, PASSWORD)).status).toBe(200);
  });

  it('sin sesión no se puede', async () => {
    const cambio = await request(app)
      .patch('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: 'otra-bien-larga-2' });

    expect(cambio.status).toBe(401);
  });

  it('cambiar la contraseña revoca las sesiones abiertas', async () => {
    // Si se cambia una contraseña es porque puede estar comprometida. Dejar
    // vivas las sesiones que se abrieron con la anterior deja entrar siete días
    // más a quien la tuviera.
    const login = await entrar(EMAIL, PASSWORD);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((c) => c.startsWith('refresh_token='))!.split(';')[0];

    await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${login.body.accessToken as string}`)
      .send({ currentPassword: PASSWORD, newPassword: 'otra-bien-larga-2' });

    const renovar = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refresh)
      .set('x-panel-request', '1')
      .send({});

    expect(renovar.status).toBe(401);
  });
});
