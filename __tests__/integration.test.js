/**
 * Tests de integración — Flujos críticos.
 * 
 * Ejecutar: npm test
 * 
 * Pre-requisitos:
 *   - PostgreSQL con DATABASE_URL configurado
 *   - npm run db:migrate-all && npm run db:seed
 *   - Variables de entorno en .env
 * 
 * Valida los 5 flujos más importantes. Si pasan, el 80% funciona.
 */

const request = require('supertest');
const app = require('../src/index');

let accessToken;
let serviceId;
let appointmentId;

// ═══════════════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════════════

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@elbrillante.co', password: 'admin123' });

  expect(res.status).toBe(200);
  accessToken = res.body.accessToken;

  const svc = await request(app)
    .get('/api/services')
    .set('Authorization', `Bearer ${accessToken}`);
  serviceId = svc.body[0]?.id;
});

const auth = () => ({ Authorization: `Bearer ${accessToken}` });

// ═══════════════════════════════════════════════════════════════════════
// TC-001: Turno rápido → estados → pago
// ═══════════════════════════════════════════════════════════════════════

describe('TC-001: Flujo completo de turno', () => {
  test('Crear turno rápido', async () => {
    const res = await request(app)
      .post('/api/appointments/quick')
      .set(auth())
      .send({
        customerPhone: '+573991234567',
        customerFirstName: 'Test',
        plate: 'TST001',
        serviceId,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    appointmentId = res.body.id;
  });

  test('pending → in_progress', async () => {
    const res = await request(app)
      .patch(`/api/appointments/${appointmentId}/status`)
      .set(auth())
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.started_at).not.toBeNull();
  });

  test('in_progress → done', async () => {
    const res = await request(app)
      .patch(`/api/appointments/${appointmentId}/status`)
      .set(auth())
      .send({ status: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.completed_at).not.toBeNull();
  });

  test('Registrar pago en done', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set(auth())
      .send({ appointmentId, amount: 2500000, paymentMethod: 'cash' });
    expect(res.status).toBe(201);
  });

  test('done → delivered', async () => {
    const res = await request(app)
      .patch(`/api/appointments/${appointmentId}/status`)
      .set(auth())
      .send({ status: 'delivered' });
    expect(res.status).toBe(200);
    expect(res.body.delivered_at).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TC-002: Validaciones de pago
// ═══════════════════════════════════════════════════════════════════════

describe('TC-002: Pagos', () => {
  test('Pago duplicado → 409', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set(auth())
      .send({ appointmentId, amount: 2500000, paymentMethod: 'nequi' });
    expect(res.status).toBe(409);
  });

  test('Pago sin campos requeridos → 400', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set(auth())
      .send({ appointmentId });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TC-003: Máquina de estados — transiciones inválidas
// ═══════════════════════════════════════════════════════════════════════

describe('TC-003: Transiciones inválidas', () => {
  let testId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/appointments/quick')
      .set(auth())
      .send({ customerPhone: '+573991234568', customerFirstName: 'State', plate: 'TST002', serviceId });
    testId = res.body.id;
  });

  test('pending → done FALLA', async () => {
    const res = await request(app)
      .patch(`/api/appointments/${testId}/status`)
      .set(auth())
      .send({ status: 'done' });
    expect(res.status).toBe(400);
  });

  test('pending → delivered FALLA', async () => {
    const res = await request(app)
      .patch(`/api/appointments/${testId}/status`)
      .set(auth())
      .send({ status: 'delivered' });
    expect(res.status).toBe(400);
  });

  test('pending → cancelled OK', async () => {
    const res = await request(app)
      .patch(`/api/appointments/${testId}/status`)
      .set(auth())
      .send({ status: 'cancelled' });
    expect(res.status).toBe(200);
  });

  test('cancelled → pending FALLA (estado final)', async () => {
    const res = await request(app)
      .patch(`/api/appointments/${testId}/status`)
      .set(auth())
      .send({ status: 'pending' });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TC-004: Autenticación
// ═══════════════════════════════════════════════════════════════════════

describe('TC-004: Auth', () => {
  test('Login correcto', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@elbrillante.co', password: 'admin123' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe('admin');
  });

  test('Password incorrecto → 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@elbrillante.co', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('Sin token → 401', async () => {
    const res = await request(app).get('/api/services');
    expect(res.status).toBe(401);
  });

  test('/me retorna datos', async () => {
    const res = await request(app).get('/api/auth/me').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('admin@elbrillante.co');
  });

  test('Refresh token rotation', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@elbrillante.co', password: 'admin123' });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toBe(login.body.refreshToken);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TC-005: Historial y reportes
// ═══════════════════════════════════════════════════════════════════════

describe('TC-005: Historial y reportes', () => {
  test('Búsqueda por placa', async () => {
    const res = await request(app).get('/api/history/search?q=TST001').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.vehicles.length).toBeGreaterThan(0);
  });

  test('Historial de vehículo', async () => {
    const res = await request(app).get('/api/history/vehicle/TST001').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.vehicle.plate).toBe('TST001');
    expect(res.body.appointments.length).toBeGreaterThan(0);
  });

  test('Dashboard de reportes', async () => {
    const res = await request(app).get('/api/reports/dashboard?period=today').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
  });

  test('Health check', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
