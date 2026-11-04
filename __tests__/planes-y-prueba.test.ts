/**
 * Planes Estudio, prueba gratis de verdad y sólo lectura al vencer.
 *
 * El registro prometía «14 días de prueba en funciones avanzadas» y el lavadero
 * nuevo quedaba en el plan Gratis desde el primer día: nada miraba la fecha.
 * Ver shared/middleware/suscripcion.ts y migrate-planes-estudio.ts.
 *
 * Para comprobar «no bloquea» se manda un alta de servicio **vacía**: si la
 * suscripción deja pasar, responde la validación (400); si no, el 402 de sólo
 * lectura. Así la prueba no crea nada y distingue los dos casos sin ambigüedad.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import * as db from '../src/shared/db';
import { config } from '../src/config';
import { estadoDeSuscripcion, precioConDescuento } from '../src/shared/middleware/suscripcion';

const correo = `planes-${Date.now()}@ejemplo.co`;
let token: string;
let tenantId: string;

const auth = () => ({ Authorization: `Bearer ${token}` });
const uso = async () => (await request(app).get('/api/tenants/me/usage').set(auth())).body;
const altaVacia = () => request(app).post('/api/services').set(auth()).send({});
const ajustar = (sql: string, params: unknown[] = []) =>
  db.queryAdmin(`UPDATE tenants SET ${sql} WHERE id = $1`, [tenantId, ...params] as never[]);

beforeAll(async () => {
  const res = await request(app).post('/api/onboarding/register').send({
    aceptaPolitica: true,
    businessName: 'Estudio de Prueba Planes',
    phone: '3007776655',
    openingTime: '08:00',
    closingTime: '18:00',
    adminEmail: correo,
    adminPassword: 'Segura123',
    adminFirstName: 'Dueña',
  });
  expect([res.status, 'registro']).toEqual([201, 'registro']);
  token = res.body.accessToken;
  tenantId = res.body.tenant.id;
});

afterAll(async () => {
  await db.queryAdmin('DELETE FROM customers WHERE tenant_id = $1', [tenantId]);
  await db.queryAdmin('DELETE FROM services WHERE tenant_id = $1', [tenantId]);
  await db.queryAdmin('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
  await db.queryAdmin('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await db.pool.end();
});

describe('un lavadero nuevo', () => {
  it('arranca en prueba de 14 días con todo lo de Estudio Pro', async () => {
    const u = await uso();
    expect(u.plan.id).toBe('estudio_pro');
    expect(u.subscription.status).toBe('trial');
    expect(u.subscription.trialDaysLeft).toBe(14);
    expect(u.subscription.readOnly).toBe(false);
    expect(u.features).toEqual({ whatsapp: true, billing: true, reports: true });
  });

  it('en Estudio Pro, los límites son «sin límite» y no un número inventado', async () => {
    const u = await uso();
    expect(u.usage.operators.limit).toBeNull();
    expect(u.usage.appointments.limit).toBeNull();
    expect(u.usage.operators.pct).toBeNull();
  });

  it('ve para comparar sólo los planes que se ofrecen', async () => {
    const u = await uso();
    expect(u.availablePlans.map((p: { id: string }) => p.id)).toEqual(['estudio', 'estudio_pro']);
  });

  it('durante la prueba puede registrar cosas', async () => {
    expect((await altaVacia()).status).toBe(400); // la validación, no el bloqueo
  });
});

describe('cuando la prueba vence', () => {
  beforeAll(() => ajustar(`trial_ends_at = NOW() - INTERVAL '1 hour'`));

  it('ve todo', async () => {
    expect((await request(app).get('/api/services').set(auth())).status).toBe(200);
    const u = await uso();
    expect(u.subscription.readOnly).toBe(true);
    expect(u.subscription.trialDaysLeft).toBe(0);
  });

  it('no puede registrar nada, y el mensaje dice qué hacer', async () => {
    const res = await altaVacia();
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/prueba/i);
    expect(res.body.error).toMatch(/Configuración → Plan/);
  });

  it('pero sí puede anonimizar a un cliente: es un derecho del cliente (Ley 1581)', async () => {
    const { rows } = await db.queryAdmin<{ id: string }>(
      `INSERT INTO customers (tenant_id, first_name, last_name, phone)
       VALUES ($1, 'Persona', 'Que Pide Supresión', '+573009990001') RETURNING id`,
      [tenantId],
    );
    const res = await request(app).post(`/api/customers/${rows[0].id}/anonimizar`).set(auth()).send({});
    expect(res.status).not.toBe(402);
    expect(res.status).toBeLessThan(300);
  });

  it('cuando el superadmin lo marca activo, vuelve a poder registrar', async () => {
    const superadmin = jwt.sign(
      { sub: '00000000-0000-0000-0000-0000000000aa', tenantId: null, role: 'super_admin', email: 's@qlarity.test' },
      config.JWT_SECRET,
      { expiresIn: '5m' },
    );
    const res = await request(app)
      .patch(`/api/superadmin/tenants/${tenantId}`)
      .set('Authorization', `Bearer ${superadmin}`)
      .send({ subscription_status: 'active', plan: 'estudio', discount_pct: 30, discount_until: '2099-12-31' });
    expect(res.status).toBe(200);

    expect((await altaVacia()).status).toBe(400);
    const u = await uso();
    expect(u.subscription.readOnly).toBe(false);
    expect(u.plan.id).toBe('estudio');
  });
});

describe('suspendido', () => {
  it('queda en sólo lectura aunque la fecha de prueba no haya vencido', async () => {
    await ajustar(`subscription_status = 'suspended', trial_ends_at = NOW() + INTERVAL '10 days'`);
    const res = await altaVacia();
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/suspendida/i);
    await ajustar(`subscription_status = 'active'`);
  });
});

describe('precio fundador', () => {
  it('con el descuento vigente, paga el 70%', async () => {
    await ajustar(`plan = 'estudio', discount_pct = 30, discount_until = CURRENT_DATE + 30`);
    const u = await uso();
    expect(u.plan.priceMonthly).toBe(14_900_000);
    expect(u.plan.priceWithDiscount).toBe(10_430_000);
  });

  it('vencido el descuento, paga el precio completo', async () => {
    await ajustar(`discount_until = CURRENT_DATE - 1`);
    expect((await uso()).plan.priceWithDiscount).toBe(14_900_000);
  });
});

describe('un plan que ya no se ofrece', () => {
  it('sigue limitando a quien lo tiene', async () => {
    // Gratis permite 3 servicios. Antes los límites sólo leían planes activos:
    // al desactivar Gratis, este lavadero habría quedado sin ningún límite.
    await ajustar(`plan = 'free', subscription_status = 'active'`);
    await db.queryAdmin('DELETE FROM services WHERE tenant_id = $1', [tenantId]);
    for (const n of [1, 2, 3]) {
      await db.queryAdmin(
        `INSERT INTO services (tenant_id, name, price_sedan, price_suv, price_camioneta, price_moto, price_pickup)
         VALUES ($1, $2, 1000000, 1000000, 1000000, 1000000, 1000000)`,
        [tenantId, `Servicio ${n}`],
      );
    }
    const res = await request(app).post('/api/services').set(auth()).send({
      name: 'El cuarto', priceSedan: 1000000, priceSuv: 1000000, priceCamioneta: 1000000,
      priceMoto: 1000000, pricePickup: 1000000,
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/máximo 3 servicios/);
  });

  it('y el mensaje de una función que no incluye nombra el plan que sí', async () => {
    const res = await request(app).get('/api/reports/dashboard').set(auth());
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Está en Estudio y Estudio Pro/);
  });
});

describe('las cuentas, sin base de datos', () => {
  const ahora = new Date('2026-11-10T12:00:00Z');
  it('sin fecha de fin de prueba no hay nada que vencer', () => {
    expect(estadoDeSuscripcion({ subscription_status: 'trial', trial_ends_at: null }, ahora).soloLectura).toBe(false);
  });
  it('el último día de prueba todavía cuenta como un día', () => {
    const fin = new Date(ahora.getTime() + 60 * 60 * 1000);
    expect(estadoDeSuscripcion({ subscription_status: 'trial', trial_ends_at: fin }, ahora)).toEqual({
      soloLectura: false,
      diasDePrueba: 1,
    });
  });
  it('el descuento vale hasta el final de su último día', () => {
    expect(precioConDescuento(10_000, { discount_pct: 30, discount_until: '2026-11-10' }, ahora)).toBe(7_000);
    expect(precioConDescuento(10_000, { discount_pct: 30, discount_until: '2026-11-09' }, ahora)).toBe(10_000);
  });
});
