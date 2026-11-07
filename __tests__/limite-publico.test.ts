/**
 * Las páginas públicas tienen su propio límite de peticiones, por lavadero.
 *
 * Antes compartían el balde anónimo del límite global, y en producción todos
 * llegan con la IP del balanceador (brecha #7): 100 peticiones a una página de
 * reservas dejaban a todos los lavaderos sin poder iniciar sesión. Se comprobó
 * contra el servidor antes de arreglarlo. Ver limiteGlobal.ts.
 */
process.env.PUBLIC_RATE_LIMIT_MAX = '3';

import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';

afterAll(async () => {
  await db.pool.end();
});

it('agotar la página de un lavadero no bloquea el login ni la página de otro', async () => {
  for (let i = 0; i < 3; i++) {
    expect((await request(app).get('/api/publico/lavaderos/el-brillante/reservas')).status).toBe(200);
  }
  const bloqueada = await request(app).get('/api/publico/lavaderos/el-brillante/reservas');
  expect(bloqueada.status).toBe(429);
  expect(bloqueada.body.error).toMatch(/demasiadas solicitudes/i);

  // Otro lavadero (aunque no exista) tiene su propio balde: 404, no 429.
  expect((await request(app).get('/api/publico/lavaderos/otro-lavadero/reservas')).status).toBe(404);

  // Y el panel sigue entrando.
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@elbrillante.co', password: 'admin123' });
  expect(login.status).toBe(200);
});
