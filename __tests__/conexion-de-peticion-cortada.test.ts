/**
 * Una petición que el navegador corta no se queda con una conexión del pool.
 *
 * Volvió a pasar en el CI del panel, en Firefox y en Safari móvil: el pool con
 * sus diez conexiones tomadas (`abiertas=10 libres=0`), PostgreSQL viéndolas
 * a todas `idle`, y desde ahí cada login contestando 500 a los 5 s.
 *
 * La causa: el middleware de RLS esperaba `pool.connect()` y **recién después**
 * se suscribía a `res.on('close')` para devolver la conexión. Si el navegador
 * cortaba la petición durante esa espera —Firefox y WebKit cancelan lo que
 * esté en vuelo al navegar—, `close` ya había sonado y no vuelve a sonar. La
 * conexión no volvía nunca.
 *
 * Y se alimenta solo: cuanto más ocupado el pool, más larga la espera de
 * `connect()`, más ancha la ventana y más conexiones se pierden.
 *
 * Para reproducirlo sin depender del azar se ocupa el pool entero, así la
 * petición queda esperando `connect()` el tiempo que haga falta; se corta;
 * y se suelta el pool. Con el error, una conexión queda tomada para siempre.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import type { PoolClient } from 'pg';
import app from '../src/index';
import * as db from '../src/shared/db';

const { pool } = db;
let servidor: http.Server;
let puerto: number;

beforeAll(async () => {
  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  puerto = (servidor.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => servidor.close(r));
  await pool.end();
});

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Un login, cortado por el cliente a los `ms` milisegundos. */
function loginCortado(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const cuerpo = JSON.stringify({ email: 'admin@elbrillante.co', password: 'admin123' });
    const pedido = http.request({
      host: '127.0.0.1',
      port: puerto,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(cuerpo) },
    });
    pedido.on('error', () => resolve());
    pedido.write(cuerpo);
    pedido.end();
    setTimeout(() => {
      pedido.destroy();
      resolve();
    }, ms);
  });
}

/** Espera a que el pool se calme: nadie esperando y todo lo abierto, libre. */
async function poolEnReposo(): Promise<{ abiertas: number; libres: number; esperando: number }> {
  for (let i = 0; i < 40; i++) {
    if (pool.waitingCount === 0 && pool.idleCount === pool.totalCount) break;
    await esperar(100);
  }
  return { abiertas: pool.totalCount, libres: pool.idleCount, esperando: pool.waitingCount };
}

describe('una petición cortada mientras espera conexión', () => {
  it('devuelve la conexión al pool igual', async () => {
    // Ocupar el pool entero: así el login se queda esperando `connect()`.
    const max = (pool as unknown as { options: { max: number } }).options.max;
    const ocupadas: PoolClient[] = [];
    for (let i = 0; i < max; i++) ocupadas.push(await pool.connect());

    // El navegador corta mientras la petición espera.
    await loginCortado(300);
    await esperar(100);

    // Se libera el pool: la petición cortada recibe su conexión ahora,
    // con `close` ya sonado.
    for (const c of ocupadas) c.release();

    const estado = await poolEnReposo();
    // La aserción que importa: con el error queda `libres = abiertas - 1`
    // para siempre.
    expect(estado).toEqual({ abiertas: estado.abiertas, libres: estado.abiertas, esperando: 0 });
  });

  it('y el servidor sigue atendiendo después', async () => {
    const res = await fetch(`http://127.0.0.1:${puerto}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@elbrillante.co', password: 'admin123' }),
    });
    expect(res.status).toBe(200);
  });
});
