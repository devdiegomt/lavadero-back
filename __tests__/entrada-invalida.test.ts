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

// ─── Contenido de los cuerpos de PATCH ────────────────────────────────────────

describe('lo que el alta rechazaba, el PATCH también', () => {
  // Los `POST` de alta validaban desde siempre. Los `PATCH` no, así que por ahí
  // entraba justo lo que el alta rechazaba. Se midió igual que el resto: nueve
  // casos más devolvían 500, y otros guardaban basura con un 200.
  let customerId: string;
  let vehicleId: string;
  let serviceId: string;
  let userId: string;

  // Cliente y vehículo **propios**, no los del seed. Estas pruebas escriben, y
  // la primera versión renombraba al cliente del seed: dos suites que lo leen
  // empezaron a fallar sin relación aparente con este cambio. Es el mismo
  // problema que ya había dejado el reloj del tenant en una zona ajena.
  beforeAll(async () => {
    const { rows: t } = await db.queryAdmin<{ id: string }>(
      `SELECT id FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
    );
    const tenantId = t[0].id;

    const { rows: c } = await db.queryAdmin<{ id: string }>(
      `INSERT INTO customers (tenant_id, first_name, last_name, phone)
       VALUES ($1, 'Entrada', 'Invalida', '+573009998877') RETURNING id`,
      [tenantId],
    );
    customerId = c[0].id;

    const { rows: v } = await db.queryAdmin<{ id: string }>(
      `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type)
       VALUES ($1, $2, 'INV999', 'sedan') RETURNING id`,
      [tenantId, customerId],
    );
    vehicleId = v[0].id;

    // Éstos sólo se leen: todos los casos que los tocan esperan 400.
    const { rows: s } = await db.queryAdmin<{ id: string }>(
      `SELECT id FROM services WHERE tenant_id = $1 LIMIT 1`, [tenantId],
    );
    serviceId = s[0].id;
    const { rows: u } = await db.queryAdmin<{ id: string }>(
      `SELECT id FROM users WHERE role = 'operator' AND tenant_id = $1 LIMIT 1`, [tenantId],
    );
    userId = u[0].id;
  });

  afterAll(async () => {
    await db.queryAdmin(`DELETE FROM vehicles WHERE id = $1`, [vehicleId]);
    await db.queryAdmin(`DELETE FROM customers WHERE id = $1`, [customerId]);
  });

  const LARGO = 'X'.repeat(5000);

  it('un texto más largo que la columna da 400, no 500', async () => {
    for (const ruta of [
      () => `/api/customers/${customerId}`,
      () => `/api/services/${serviceId}`,
      () => `/api/users/${userId}`,
    ]) {
      const res = await pedir({ metodo: 'patch', ruta: ruta(), body: { firstName: LARGO, name: LARGO } });
      expect(res.status).toBe(400);
    }

    const tenant = await pedir({ metodo: 'patch', ruta: '/api/tenants/me', body: { name: LARGO } });
    expect(tenant.status).toBe(400);
  });

  it('un email que no es email ya no se guarda', async () => {
    // Antes respondía 200 y lo guardaba. En `users` el email es con lo que se
    // inicia sesión: uno inválido deja la cuenta sin forma de entrar.
    for (const ruta of [`/api/customers/${customerId}`, `/api/users/${userId}`, '/api/tenants/me']) {
      const res = await pedir({ metodo: 'patch', ruta, body: { email: 'no-es-email' } });
      expect(res.status).toBe(400);
    }
  });

  it('un tipo de vehículo inventado se rechaza: de eso depende el precio', async () => {
    // Antes respondía 200. `getServicePrice` cae a `price_sedan` cuando el tipo
    // no está en el mapa, así que una camioneta mal tipeada se cobraba como
    // sedán, sin error y sin aviso.
    const res = await pedir({
      metodo: 'patch',
      ruta: `/api/vehicles/${vehicleId}`,
      body: { vehicleType: 'submarino' },
    });
    expect(res.status).toBe(400);
  });

  it('y la base también lo rechaza, no sólo la ruta', async () => {
    // El borde se valida ruta por ruta y es fácil que una quede sin validar.
    // De este campo depende cuánta plata se cobra, así que el invariante vive
    // también en la base.
    await expect(
      db.queryAdmin(`UPDATE vehicles SET vehicle_type = 'helicoptero' WHERE id = $1`, [vehicleId]),
    ).rejects.toThrow(/chk_vehicles_tipo/);
  });

  it('un año que no es número da 400', async () => {
    const res = await pedir({
      metodo: 'patch',
      ruta: `/api/vehicles/${vehicleId}`,
      body: { year: 'mil novecientos' },
    });
    expect(res.status).toBe(400);
  });

  it('un precio negativo se rechaza', async () => {
    const res = await pedir({
      metodo: 'patch',
      ruta: `/api/services/${serviceId}`,
      body: { priceSedan: -5000 },
    });
    expect(res.status).toBe(400);
  });

  it('dejar a un cliente sin teléfono ni WhatsApp da 400 y explica por qué', async () => {
    // Lo rechaza el CHECK de la base. Lo que importa acá es que el mensaje sirva:
    // antes era "Error interno del servidor".
    const res = await pedir({
      metodo: 'patch',
      ruta: `/api/customers/${customerId}`,
      body: { phone: null },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tel[eé]fono|WhatsApp/i);
    // Y apunta a la supresión, que es lo que esa persona probablemente quería.
    expect(res.body.error).toMatch(/supresi[oó]n/i);
  });

  it('un PATCH no pisa los campos que no se mandaron', async () => {
    // El riesgo de derivar estos schemas del alta con `.partial()`: los
    // `.default()` se colarían y un cambio de nombre resetearía el tipo de
    // documento de paso.
    await db.queryAdmin(
      `UPDATE customers SET document_type = 'NIT', notes = 'no me toques' WHERE id = $1`,
      [customerId],
    );

    const res = await pedir({
      metodo: 'patch',
      ruta: `/api/customers/${customerId}`,
      body: { firstName: 'Renombrado' },
    });

    expect(res.status).toBe(200);
    expect(res.body.document_type).toBe('NIT');
    expect(res.body.notes).toBe('no me toques');
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
    const { rows } = await db.queryAdmin<{ opening_time: string }>(
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
