/**
 * La sesión en una cookie `httpOnly`, no en `localStorage`.
 *
 * La brecha: los dos tokens se guardaban en `localStorage`, legible por cualquier
 * JavaScript de la página. Un XSS se llevaba el refresh token y con él **siete
 * días de sesión renovable**, que sobreviven al cierre del navegador.
 *
 * Lo que más importa probar:
 *
 * 1. Que el refresh token **no salga** en el cuerpo, porque mientras salga el
 *    frontend puede seguir guardándolo donde no debe.
 * 2. Que la cookie no sea legible por JavaScript (`HttpOnly`).
 * 3. Que las rutas que cambian datos **no** se autentiquen con la cookie: es lo
 *    que las hace inmunes a CSRF y lo que evitó tener que poner un token CSRF en
 *    las 80 rutas.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';
import { NOMBRE_COOKIE, CABECERA_INTENCION } from '../src/modules/auth/cookies';

const EMAIL = 'admin@elbrillante.co';
const PASSWORD = 'admin123';

/** La cookie de sesión tal como la manda el servidor, lista para reenviar. */
function cookieDe(res: request.Response): string {
  const puestas = res.headers['set-cookie'] as unknown as string[] | undefined;
  const refresh = (puestas ?? []).find((c) => c.startsWith(`${NOMBRE_COOKIE}=`));
  if (!refresh) throw new Error('el servidor no puso la cookie de sesión');
  return refresh.split(';')[0];
}

/** El Set-Cookie completo, para inspeccionar sus atributos. */
function setCookieDe(res: request.Response): string {
  const puestas = res.headers['set-cookie'] as unknown as string[] | undefined;
  const refresh = (puestas ?? []).find((c) => c.startsWith(`${NOMBRE_COOKIE}=`));
  if (!refresh) throw new Error('el servidor no puso la cookie de sesión');
  return refresh;
}

function entrar() {
  return request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
}

afterAll(async () => {
  await db.queryAdmin(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = (SELECT id FROM users WHERE email = $1) AND revoked_at IS NULL`,
    [EMAIL],
  );
  await db.pool.end();
});

describe('el refresh token sale en una cookie, no en el cuerpo', () => {
  it('el login pone la cookie y el cuerpo no trae el token', async () => {
    const res = await entrar();

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    // Mientras salga en el cuerpo, el frontend puede seguir guardándolo en
    // localStorage — que es la brecha, no un detalle de forma.
    expect(res.body.refreshToken).toBeUndefined();
    expect(cookieDe(res)).toContain(`${NOMBRE_COOKIE}=`);
  });

  it('la cookie es HttpOnly, acotada a /api/auth y con SameSite', async () => {
    const set = setCookieDe(await entrar());

    // HttpOnly es lo único que hace que un XSS no la pueda leer. Sin esto, todo
    // lo demás es mudanza sin mejora.
    expect(set).toMatch(/HttpOnly/i);
    // Acotada: no viaja en cada petición al API, así que tampoco se expone en
    // cada una.
    expect(set).toMatch(/Path=\/api\/auth/i);
    expect(set).toMatch(/SameSite=/i);
  });

  it('el token de la cookie no aparece en ninguna parte del cuerpo', async () => {
    const res = await entrar();
    const valor = cookieDe(res).split('=')[1];
    expect(JSON.stringify(res.body)).not.toContain(valor);
  });
});

describe('renovar la sesión', () => {
  it('funciona con la cookie sola, sin nada en el cuerpo', async () => {
    const login = await entrar();

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieDe(login))
      .set(CABECERA_INTENCION, '1')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it('rota la cookie: la anterior deja de servir', async () => {
    const login = await entrar();
    const primera = cookieDe(login);

    const renovada = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', primera)
      .set(CABECERA_INTENCION, '1')
      .send({});
    const segunda = cookieDe(renovada);
    expect(segunda).not.toBe(primera);

    // Si alguien robó la primera, deja de valer en cuanto el dueño renueva.
    const conLaVieja = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', primera)
      .set(CABECERA_INTENCION, '1')
      .send({});
    expect(conLaVieja.status).toBe(401);
  });

  it('el access token que devuelve sirve de verdad', async () => {
    const login = await entrar();
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieDe(login))
      .set(CABECERA_INTENCION, '1')
      .send({});

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken as string}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(EMAIL);
  });
});

describe('CSRF en los dos endpoints que usan la cookie', () => {
  it('sin la cabecera de intención, la cookie no alcanza', async () => {
    // Un `<form>` de un sitio ajeno no puede poner cabeceras propias, y un fetch
    // cross-origin que las pone dispara un preflight que CORS rechaza.
    const login = await entrar();

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieDe(login))
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toContain(CABECERA_INTENCION);
  });

  it('con el token en el cuerpo no se exige: quien lo manda ya lo tenía', async () => {
    // Es el camino de transición para un frontend viejo. No hay nada que un sitio
    // ajeno pueda provocar, porque no tiene el token.
    const { rows } = await db.queryAdmin<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`, [EMAIL],
    );
    expect(rows).toHaveLength(1);

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'no-existe-pero-llega-por-el-cuerpo' });

    // 401 por token inválido, NO 403 por falta de cabecera: el camino se recorrió.
    expect(res.status).toBe(401);
  });

  it('las rutas que cambian datos no se autentican con la cookie', async () => {
    // Esto es lo que las hace inmunes a CSRF por construcción, y la razón de que
    // esto no fuera el proyecto de poner un token CSRF en las 80 rutas: el
    // navegador nunca adjunta `Authorization` por su cuenta.
    const login = await entrar();

    const res = await request(app)
      .post('/api/customers')
      .set('Cookie', cookieDe(login))
      .send({ firstName: 'PorCSRF', phone: '3001234567' });

    expect(res.status).toBe(401);
  });
});

describe('el registro de un lavadero nuevo', () => {
  it('también pone la cookie: si no, la sesión dura 15 minutos', async () => {
    // El síntoma de olvidarlo sería "me echa al rato de crear la cuenta", y no
    // señalaría al onboarding.
    const slug = `cookie-${Date.now()}`;
    const res = await request(app).post('/api/onboarding/register').send({
      businessName: 'Lavadero Cookie',
      phone: '3009998888',
      openingTime: '07:00',
      closingTime: '19:00',
      adminEmail: `${slug}@ejemplo.co`,
      adminPassword: 'Segura123',
      adminFirstName: 'Dueño',
    });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined();
    expect(setCookieDe(res)).toMatch(/HttpOnly/i);

    // Y la cookie sirve para renovar de verdad.
    const renovado = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieDe(res))
      .set(CABECERA_INTENCION, '1')
      .send({});
    expect(renovado.status).toBe(200);

    // Por el usuario, no por el slug: el slug lo genera el onboarding a partir
    // del nombre del negocio ("Lavadero Cookie" → "lavadero-cookie"), así que un
    // LIKE contra mi variable no casaba nunca y los tenants se acumulaban.
    const { rows: creado } = await db.queryAdmin<{ tenant_id: string }>(
      `SELECT tenant_id FROM users WHERE email = $1`, [`${slug}@ejemplo.co`],
    );
    await db.queryAdmin(`DELETE FROM users WHERE email = $1`, [`${slug}@ejemplo.co`]);
    if (creado[0]?.tenant_id) {
      await db.queryAdmin(`DELETE FROM tenants WHERE id = $1`, [creado[0].tenant_id]);
    }
  });
});

describe('cerrar sesión', () => {
  it('borra la cookie y revoca el token', async () => {
    const login = await entrar();
    const cookie = cookieDe(login);

    const salida = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('Authorization', `Bearer ${login.body.accessToken as string}`)
      .set(CABECERA_INTENCION, '1')
      .send({});
    expect(salida.status).toBe(200);

    // El navegador tiene que olvidarla: dejar una credencial muerta ahí no tiene
    // ninguna ventaja.
    const borrada = setCookieDe(salida);
    expect(borrada).toMatch(new RegExp(`${NOMBRE_COOKIE}=;|${NOMBRE_COOKIE}=\\s*;`));

    // Y aunque alguien la hubiera copiado antes, ya no sirve.
    const despues = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
      .set(CABECERA_INTENCION, '1')
      .send({});
    expect(despues.status).toBe(401);
  });
});
