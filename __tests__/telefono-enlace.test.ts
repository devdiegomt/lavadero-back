/**
 * El cliente duplicado: la misma persona en dos filas.
 *
 * Pasó en producción. Un cliente cargado desde el panel como `3223772019` y el
 * mismo cliente escribiendo por WhatsApp, donde bot-wa manda `+573223772019`.
 * La búsqueda compara `phone = $1` como texto, así que no se enlazaron: dos
 * filas, el historial partido y `visit_count` contando la mitad en cada una.
 *
 * El arreglo tiene dos mitades y las dos hacen falta:
 *
 * 1. **Canonizar lo que entra** — evita duplicados nuevos.
 * 2. **La migración** — enlaza los que ya están escritos. Sin ella la mitad 1
 *    no sirve para nadie que ya tenga datos, que es el caso de siempre.
 *
 * Las dos se prueban acá, por separado, para que quede claro que ninguna tapa
 * el hueco de la otra.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';
import { buscarOCrearCliente, leerIdentidad } from '../src/modules/whatsapp/wa-identity';
import { normalizarColumna } from '../src/shared/db/migrate-telefonos';

const SIN_PREFIJO = '3223772019';
const CANONICO = '+573223772019';
const LID = '55500011122@lid';

let tenantId: string;
let token: string;

beforeAll(async () => {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenantId = rows[0].id;

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@elbrillante.co', password: 'admin123' });
  token = login.body.accessToken;
  expect(token).toBeTruthy();
});

afterEach(async () => {
  await db.query(
    `DELETE FROM customers WHERE tenant_id = $1 AND (phone IN ($2, $3) OR wa_lid = $4)`,
    [tenantId, SIN_PREFIJO, CANONICO, LID],
  );
});

afterAll(async () => {
  await db.pool.end();
});

describe('mitad 1: lo que entra queda canónico', () => {
  it('el panel guarda +57… aunque lo escriban sin prefijo', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Diego', lastName: 'Duplicado', phone: SIN_PREFIJO });

    expect(res.status).toBe(201);
    expect(res.body.phone).toBe(CANONICO);
  });

  it('y entonces el bot lo encuentra en vez de crear otro', async () => {
    // Como lo carga la recepcionista: a secas, como lo dictó el cliente.
    const creado = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Diego', lastName: 'Duplicado', phone: '322 377 2019' });
    expect(creado.status).toBe(201);

    // Como llega desde bot-wa: E.164 y con LID.
    const id = await buscarOCrearCliente(
      tenantId,
      leerIdentidad({ phone: CANONICO, waLid: LID }),
      'Diego',
    );

    expect(id).toBe(creado.body.id);

    // Y de paso queda enlazado el WhatsApp, que es el objetivo.
    const { rows } = await db.query<{ cuantos: string }>(
      `SELECT count(*) AS cuantos FROM customers
       WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL`,
      [tenantId, CANONICO],
    );
    expect(rows[0].cuantos).toBe('1');
  });

  it('un teléfono sin un solo dígito se rechaza con 400, no se guarda vacío', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Nadie', phone: '---------' });

    expect(res.status).toBe(400);
  });

  it('editar desde el panel tampoco desenlaza al cliente', async () => {
    // Esta ruta no pasa por Zod, así que es la que más fácil se olvida.
    const creado = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Diego', phone: '+573001119999' });
    expect(creado.status).toBe(201);

    const res = await request(app)
      .patch(`/api/customers/${creado.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: SIN_PREFIJO });

    expect(res.status).toBe(200);
    expect(res.body.phone).toBe(CANONICO);

    await db.query(`DELETE FROM customers WHERE id = $1`, [creado.body.id]);
  });
});

describe('mitad 2: la migración enlaza lo que ya estaba escrito', () => {
  it('un cliente guardado antes del arreglo no se encuentra… hasta normalizar', async () => {
    // Escrito directo en la base: así quedaron las filas cargadas antes de que
    // existiera `normalizarTelefono`. Pasar por el endpoint ya las canonizaría
    // y la prueba no probaría nada.
    const { rows: creado } = await db.query<{ id: string }>(
      `INSERT INTO customers (tenant_id, first_name, phone) VALUES ($1, 'Diego', $2) RETURNING id`,
      [tenantId, SIN_PREFIJO],
    );

    // Antes: el bot no lo ve, y crearía un segundo cliente. Este es el bug.
    const sinMigrar = await db.query(
      `SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL`,
      [tenantId, CANONICO],
    );
    expect(sinMigrar.rows).toHaveLength(0);

    const cambiadas = await normalizarColumna('customers', 'phone');
    expect(cambiadas).toBeGreaterThanOrEqual(1);

    // Después: es el mismo cliente, no uno nuevo.
    const id = await buscarOCrearCliente(
      tenantId,
      leerIdentidad({ phone: CANONICO, waLid: LID }),
      'Diego',
    );
    expect(id).toBe(creado[0].id);
  });

  it('correrla dos veces no cambia nada la segunda', async () => {
    await db.query(
      `INSERT INTO customers (tenant_id, first_name, phone) VALUES ($1, 'Diego', $2)`,
      [tenantId, SIN_PREFIJO],
    );

    expect(await normalizarColumna('customers', 'phone')).toBeGreaterThanOrEqual(1);
    // Idempotente: es el requisito de todas las migraciones del proyecto.
    expect(await normalizarColumna('customers', 'phone')).toBe(0);
  });
});
