/**
 * Integración del bridge de WhatsApp contra Postgres y Redis reales.
 *
 * Cubre los cinco endpoints que consume n8n y la conversación completa de
 * agendamiento, que hasta ahora solo se había probado con mocks.
 *
 * Requiere la BD migrada y con seed (npm run db:reset).
 */
import request from 'supertest';
import Redis from 'ioredis';
import app from '../src/index';
import * as db from '../src/shared/db';
import { initBooking } from '../src/modules/whatsapp/wa-bridge.booking';

const API_KEY = process.env.N8N_API_KEY as string;
const TENANT_PHONE = '+573223772019';
const CLIENTE = '+573101112233'; // María García, del seed
const PLACA = 'ABC123';

let redis: Redis;

const auth = (r: request.Test) =>
  r.set('x-api-key', API_KEY).set('x-tenant-phone', TENANT_PHONE);

beforeAll(async () => {
  // index.ts no inicializa Redis con NODE_ENV=test, así que se hace acá.
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 2 });
  initBooking(redis);

  await db.query(
    `UPDATE tenants SET whatsapp_phone = $1, is_active = true
     WHERE slug = 'el-brillante'`,
    [TENANT_PHONE],
  );
  await redis.flushdb();
});

afterAll(async () => {
  await redis.quit();
  await db.pool.end();
});

describe('wa-bridge: autenticación y tenant', () => {
  it('sin api key → 401', async () => {
    const res = await request(app)
      .get('/api/wa-bridge/services')
      .set('x-tenant-phone', TENANT_PHONE);
    expect(res.status).toBe(401);
  });

  it('tenant desconocido → 404', async () => {
    const res = await request(app)
      .get('/api/wa-bridge/services')
      .set('x-api-key', API_KEY)
      .set('x-tenant-phone', '+570000000000');
    expect(res.status).toBe(404);
  });
});

describe('wa-bridge: consultas', () => {
  it('services devuelve precios por tipo de vehículo', async () => {
    const res = await auth(request(app).get('/api/wa-bridge/services'));
    expect(res.status).toBe(200);
    expect(res.body.services.length).toBeGreaterThan(0);
    const s = res.body.services[0];
    // Las columnas que el formateador de n8n espera
    expect(s).toHaveProperty('price_sedan');
    expect(s).toHaveProperty('price_moto');
    expect(s).toHaveProperty('estimated_minutes');
    expect(s).not.toHaveProperty('price');
  });

  it('appointment-status sin placa → 400', async () => {
    const res = await auth(request(app).get('/api/wa-bridge/appointment-status'));
    expect(res.status).toBe(400);
  });

  it('appointment-status con placa inexistente → found:false', async () => {
    const res = await auth(
      request(app).get('/api/wa-bridge/appointment-status?plate=ZZZ999'),
    );
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  it('customer-history de un cliente del seed', async () => {
    const res = await auth(
      request(app).get(`/api/wa-bridge/customer-history?phone=${encodeURIComponent(CLIENTE)}`),
    );
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.customer.name).toContain('María');
  });

  it('customer-history de un número desconocido → found:false', async () => {
    const res = await auth(
      request(app).get('/api/wa-bridge/customer-history?phone=%2B570000000001'),
    );
    expect(res.body.found).toBe(false);
  });
});

describe('wa-bridge: auditoría', () => {
  it('registra el mensaje con external_id y flow_step', async () => {
    const messageId = 'WAMSG-' + Date.now();
    const res = await auth(
      request(app).post('/api/wa-bridge/log').send({
        phone: CLIENTE,
        direction: 'inbound',
        content: 'hola, como va mi carro?',
        flowStep: 'check_status',
        messageId,
      }),
    );
    expect(res.status).toBe(201);

    const { rows } = await db.query<{
      external_id: string; flow_step: string; direction: string; content: string;
    }>(
      `SELECT external_id, flow_step, direction, content
       FROM whatsapp_messages WHERE external_id = $1`,
      [messageId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].flow_step).toBe('check_status');
    expect(rows[0].direction).toBe('inbound');
  });

  it('direction inválido → 400', async () => {
    const res = await auth(
      request(app).post('/api/wa-bridge/log').send({
        phone: CLIENTE, direction: 'sideways', content: 'x',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('phone de más de 20 chars → 400, no 500 de la BD', async () => {
    const res = await auth(
      request(app).post('/api/wa-bridge/log').send({
        phone: '+' + '9'.repeat(25), direction: 'inbound', content: 'x',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('trunca flow_step y external_id a lo que aguanta la columna', async () => {
    const res = await auth(
      request(app).post('/api/wa-bridge/log').send({
        phone: CLIENTE,
        direction: 'system',
        content: 'x',
        flowStep: 'F'.repeat(80),
        messageId: 'M'.repeat(150),
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe('wa-bridge: agendamiento conversacional', () => {
  const phone = '+573998887766'; // cliente nuevo, no está en el seed

  it('sin sesión y sin start → active:false', async () => {
    const res = await auth(
      request(app).post('/api/wa-bridge/booking-step').send({ phone, message: 'hola' }),
    );
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });

  it('conversación completa hasta crear el turno', async () => {
    // 1. arrancar
    let res = await auth(
      request(app).post('/api/wa-bridge/booking-step').send({ phone, message: '', start: true }),
    );
    expect(res.body.active).toBe(true);
    expect(res.body.reply).toMatch(/placa/i);

    // 2. placa que existe en el seed
    res = await auth(
      request(app).post('/api/wa-bridge/booking-step').send({ phone, message: PLACA }),
    );
    expect(res.body.reply).toContain(PLACA);
    expect(res.body.step).toBe('awaiting_service');

    // 3. servicio
    res = await auth(
      request(app).post('/api/wa-bridge/booking-step').send({ phone, message: '1' }),
    );
    expect(res.body.step).toBe('awaiting_time');

    // 4. horario
    res = await auth(
      request(app).post('/api/wa-bridge/booking-step').send({ phone, message: '1' }),
    );
    expect(res.body.step).toBe('awaiting_confirm');
    expect(res.body.reply).toMatch(/confirm/i);

    // 5. confirmar
    res = await auth(
      request(app).post('/api/wa-bridge/booking-step').send({ phone, message: 'SI' }),
    );
    expect(res.body.done).toBe(true);
    expect(res.body.reply).toMatch(/agendado/i);

    // El turno quedó en la BD con precio real, no en 0
    const { rows } = await db.query<{
      price: number; source: string; status: string; scheduled_date: string; customer_id: string;
    }>(
      `SELECT a.price, a.source, a.status, a.scheduled_date, a.customer_id
       FROM appointments a
       JOIN vehicles v ON v.id = a.vehicle_id
       WHERE UPPER(v.plate) = $1 AND a.source = 'whatsapp'
       ORDER BY a.created_at DESC LIMIT 1`,
      [PLACA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('whatsapp');
    expect(rows[0].status).toBe('pending');
    expect(Number(rows[0].price)).toBeGreaterThan(0);
    expect(rows[0].customer_id).toBeTruthy();

    // La sesión se limpió al terminar
    const keys = await redis.keys('wa:session:*');
    expect(keys.filter((k) => k.includes(phone))).toHaveLength(0);
  });

  it('el turno recién creado aparece en appointment-status', async () => {
    const res = await auth(
      request(app).get(`/api/wa-bridge/appointment-status?plate=${PLACA}`),
    );
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    // Los campos que lee el formateador de n8n
    expect(res.body.appointment).toHaveProperty('scheduled_date');
    expect(res.body.appointment).toHaveProperty('service_name');
    expect(res.body.appointment.plate).toBe(PLACA);
    expect(['pending', 'in_progress']).toContain(res.body.appointment.status);
  });

  it('escribir 0 cancela y limpia la sesión', async () => {
    await auth(
      request(app).post('/api/wa-bridge/booking-step').send({ phone, message: '', start: true }),
    );
    const res = await auth(
      request(app).post('/api/wa-bridge/booking-step').send({ phone, message: '0' }),
    );
    expect(res.body.done).toBe(true);
    expect(res.body.reply).toMatch(/cancel/i);

    const after = await auth(
      request(app).post('/api/wa-bridge/booking-step').send({ phone, message: 'hola' }),
    );
    expect(after.body.active).toBe(false);
  });

  it('placa desconocida arranca el alta del cliente', async () => {
    await auth(
      request(app).post('/api/wa-bridge/booking-step').send({ phone, message: '', start: true }),
    );
    const res = await auth(
      request(app).post('/api/wa-bridge/booking-step').send({ phone, message: 'QWE888' }),
    );
    expect(res.body.reply).toMatch(/nombre/i);
    expect(res.body.step).toBe('awaiting_name');

    await auth(request(app).post('/api/wa-bridge/booking-step').send({ phone, message: '0' }));
  });

  it('placa inválida se rechaza sin perder la sesión', async () => {
    await auth(
      request(app).post('/api/wa-bridge/booking-step').send({ phone, message: '', start: true }),
    );
    const res = await auth(
      request(app).post('/api/wa-bridge/booking-step').send({ phone, message: 'no soy una placa' }),
    );
    expect(res.body.step).toBe('awaiting_plate');
    expect(res.body.active).toBe(true);

    await auth(request(app).post('/api/wa-bridge/booking-step').send({ phone, message: '0' }));
  });
});
