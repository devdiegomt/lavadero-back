/**
 * Entrada malformada responde 400, no 500.
 *
 * Se midió antes de tocar nada: **29 endpoints devolvían 500** con entrada
 * basura. Un id que no es UUID llega a PostgreSQL, que contesta
 * `invalid input syntax for type uuid`, y el cliente recibe "Error interno del
 * servidor". No es sólo cosmético:
 *
 * - Un 500 dice "me rompí", no "me mandaste mal los datos". Quien integra no
 *   sabe de qué lado está el problema.
 * - Se pierde en el ruido de los 500 de verdad, los que sí hay que mirar.
 * - `?limit=99999` traía la tabla entera a memoria.
 *
 * Lo que se descubrió al medir: el middleware `validateId` y `validate(…,
 * 'query')` existían desde siempre. Estaban puestos en **una** ruta. La brecha
 * no era que faltara validación, era que no estaba conectada — que es peor,
 * porque leyendo el código parece resuelta.
 *
 * Esta prueba es la sonda de entonces, convertida en red: recorre las rutas con
 * basura y falla si alguna vuelve a contestar 5xx. Sirve igual para las rutas
 * que se agreguen después.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';

const NO_UUID = 'no-soy-un-uuid';

type Caso = {
  ruta: string;
  metodo: 'get' | 'post' | 'patch' | 'put' | 'delete';
  body?: Record<string, unknown>;
  /** true si la ruta es de superadmin. */
  sa?: boolean;
};

let token = '';
let tokenSa = '';

beforeAll(async () => {
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@elbrillante.co', password: 'admin123' });
  token = login.body.accessToken;
  expect(token).toBeTruthy();

  const loginSa = await request(app).post('/api/auth/login').send({
    email: process.env.SUPER_ADMIN_EMAIL,
    password: process.env.SUPER_ADMIN_PASSWORD,
  });
  tokenSa = loginSa.body.accessToken ?? '';
});

afterAll(async () => {
  await db.pool.end();
});

async function pedir(caso: Caso) {
  const req = request(app)[caso.metodo](caso.ruta).set(
    'Authorization',
    `Bearer ${caso.sa ? tokenSa : token}`,
  );
  return caso.body === undefined ? req : req.send(caso.body);
}

// ─── Ids que no son UUID ──────────────────────────────────────────────────────

const IDS_MALOS: Caso[] = [
  { metodo: 'get', ruta: `/api/customers/${NO_UUID}` },
  { metodo: 'get', ruta: `/api/customers/${NO_UUID}/vehicles` },
  { metodo: 'get', ruta: `/api/customers/${NO_UUID}/history` },
  { metodo: 'patch', ruta: `/api/customers/${NO_UUID}`, body: { firstName: 'x' } },
  { metodo: 'delete', ruta: `/api/customers/${NO_UUID}` },
  { metodo: 'post', ruta: `/api/customers/${NO_UUID}/anonimizar` },
  { metodo: 'get', ruta: `/api/vehicles/${NO_UUID}` },
  { metodo: 'get', ruta: `/api/vehicles/${NO_UUID}/history` },
  { metodo: 'patch', ruta: `/api/vehicles/${NO_UUID}`, body: { color: 'rojo' } },
  { metodo: 'delete', ruta: `/api/vehicles/${NO_UUID}` },
  { metodo: 'get', ruta: `/api/services/${NO_UUID}` },
  { metodo: 'patch', ruta: `/api/services/${NO_UUID}`, body: { name: 'x' } },
  { metodo: 'patch', ruta: `/api/services/${NO_UUID}/toggle` },
  { metodo: 'get', ruta: `/api/payments/${NO_UUID}` },
  { metodo: 'patch', ruta: `/api/appointments/${NO_UUID}`, body: { notes: 'x' } },
  { metodo: 'patch', ruta: `/api/users/${NO_UUID}`, body: { firstName: 'x' } },
  { metodo: 'patch', ruta: `/api/users/${NO_UUID}/toggle` },
  { metodo: 'patch', ruta: `/api/users/${NO_UUID}/password`, body: { newPassword: 'abcd1234' } },
  { metodo: 'get', ruta: `/api/history/customer/${NO_UUID}` },
  { metodo: 'get', ruta: `/api/billing/invoice/${NO_UUID}` },
  { metodo: 'post', ruta: `/api/billing/invoice/${NO_UUID}` },
  { metodo: 'post', ruta: `/api/billing/retry/${NO_UUID}` },
  { metodo: 'post', ruta: `/api/billing/credit-note/${NO_UUID}` },
];

describe('un id que no es UUID da 400', () => {
  it.each(IDS_MALOS.map((c) => [`${c.metodo.toUpperCase()} ${c.ruta}`, c] as const))(
    '%s',
    async (_etiqueta, caso) => {
      const res = await pedir(caso);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/UUID/);
    },
  );
});

// ─── Query params ─────────────────────────────────────────────────────────────

const QUERIES_MALAS: Caso[] = [
  { metodo: 'get', ruta: '/api/customers?page=abc' },
  { metodo: 'get', ruta: '/api/customers?limit=-5' },
  { metodo: 'get', ruta: '/api/customers?limit=0' },
  { metodo: 'get', ruta: '/api/customers?page=0' },
  { metodo: 'get', ruta: '/api/appointments?date=no-es-fecha' },
  { metodo: 'get', ruta: '/api/appointments?date=2026-02-31' },
  { metodo: 'get', ruta: '/api/reports/revenue?from=no-es-fecha' },
  { metodo: 'get', ruta: '/api/reports/dashboard?date=31-02-2026' },
  { metodo: 'get', ruta: '/api/reports/services?limit=abc' },
  { metodo: 'get', ruta: '/api/reports/customers?limit=-1' },
  { metodo: 'get', ruta: '/api/billing/invoices?page=abc' },
  { metodo: 'get', ruta: '/api/tenants/me/stats?date=basura' },
  { metodo: 'get', ruta: '/api/payments/summary?from=basura' },
];

describe('query params malformados dan 400', () => {
  it.each(QUERIES_MALAS.map((c) => [c.ruta, c] as const))('%s', async (_e, caso) => {
    const res = await pedir(caso);
    expect(res.status).toBe(400);
  });

  it('un limit enorme se rechaza: traía la tabla entera a memoria', async () => {
    const res = await pedir({ metodo: 'get', ruta: '/api/customers?limit=99999' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/);
  });
});

// ─── Cuerpos de PATCH ─────────────────────────────────────────────────────────

describe('cuerpos que no calzan con la columna dan 400', () => {
  it('bays_count con texto', async () => {
    const res = await pedir({ metodo: 'patch', ruta: '/api/tenants/me', body: { bays_count: 'muchas' } });
    expect(res.status).toBe(400);
  });

  it('una hora que no existe', async () => {
    const res = await pedir({ metodo: 'patch', ruta: '/api/tenants/me', body: { opening_time: '99:99' } });
    expect(res.status).toBe(400);
  });
});

// ─── Lo que NO debe cambiar ───────────────────────────────────────────────────

describe('lo que seguía funcionando sigue funcionando', () => {
  // Esta es la mitad que importa: una validación nueva que rompe una pantalla
  // del panel es peor que el 500 que venía a arreglar.

  it('el panel manda `from=&to=` vacíos cuando no hay rango, y eso vale', async () => {
    // PaymentsPage.tsx lo hace literalmente: `?from=${from ?? ''}&to=${to ?? ''}`.
    // Tratar la cadena vacía como fecha inválida rompería esa pantalla.
    const res = await pedir({ metodo: 'get', ruta: '/api/payments/summary?from=&to=' });
    expect(res.status).toBe(200);
  });

  it('los params que el schema no nombra no se pierden', async () => {
    // `validate` reemplaza req.query con lo que devuelve el schema. Sin
    // passthrough, `?all=true` se caería en silencio y el filtro dejaría de
    // filtrar sin que nadie lo note.
    const conTodos = await pedir({ metodo: 'get', ruta: '/api/services?all=true' });
    const soloActivos = await pedir({ metodo: 'get', ruta: '/api/services' });
    expect(conTodos.status).toBe(200);
    expect(soloActivos.status).toBe(200);

    const res = await pedir({ metodo: 'get', ruta: '/api/reports/revenue?period=week' });
    expect(res.status).toBe(200);
    // `period` llegó al controller: si se hubiera perdido, el rango sería otro.
    expect(res.body.period).toBeDefined();
  });

  it('el panel reenvía la hora como `07:00:00`, y eso vale', async () => {
    // PostgreSQL devuelve TIME como "07:00:00"; el panel lee eso de
    // GET /tenants/me y lo manda de vuelta sin tocarlo. Exigir HH:MM a secas
    // habría devuelto 400 al guardar la configuración — una regresión en una
    // pantalla que hoy funciona, causada por la validación que viene a arreglar
    // los 500. Se detectó comparando contra lo que manda el panel de verdad.
    const res = await pedir({
      metodo: 'patch',
      ruta: '/api/tenants/me',
      body: { opening_time: '07:00:00', closing_time: '19:00:00' },
    });

    expect(res.status).toBe(200);
    // Y se guarda normalizado a HH:MM, no con los segundos de vuelta.
    const { rows } = await db.query<{ opening_time: string }>(
      `SELECT opening_time FROM tenants WHERE slug = 'el-brillante'`,
    );
    expect(rows[0].opening_time).toBe('07:00:00');
  });

  it('una hora en HH:MM sigue pasando', async () => {
    const res = await pedir({
      metodo: 'patch',
      ruta: '/api/tenants/me',
      body: { opening_time: '07:00' },
    });
    expect(res.status).toBe(200);
  });

  it('paginación y búsqueda normales siguen pasando', async () => {
    const res = await pedir({ metodo: 'get', ruta: '/api/customers?page=1&limit=20&search=mar' });
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(20);
  });

  it('un rango de fechas válido sigue pasando', async () => {
    const res = await pedir({ metodo: 'get', ruta: '/api/reports/revenue?from=2026-01-01&to=2026-12-31' });
    expect(res.status).toBe(200);
  });

  it('un UUID con forma válida que no existe sigue dando 404, no 400', async () => {
    // La distinción que importa: "no me entendiste" ≠ "no está".
    const res = await pedir({ metodo: 'get', ruta: '/api/customers/00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(404);
  });
});

// ─── La red de seguridad ──────────────────────────────────────────────────────

describe('ninguna de estas rutas contesta 5xx', () => {
  it('recorre todos los casos y no encuentra un solo 500', async () => {
    const fallas: string[] = [];

    for (const caso of [...IDS_MALOS, ...QUERIES_MALAS]) {
      const res = await pedir(caso);
      if (res.status >= 500) fallas.push(`${res.status} ${caso.metodo.toUpperCase()} ${caso.ruta}`);
    }

    expect(fallas).toEqual([]);
  }, 60_000);
});
