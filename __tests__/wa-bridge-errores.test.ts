/**
 * Qué pasa en `wa-bridge` cuando algo sale mal.
 *
 * Esto empezó como el resto de la brecha #2 —"el módulo `whatsapp` valida a
 * mano"— y al sondearlo resultó que la validación manual es **buena**: casi todo
 * devuelve 400 con mensajes más útiles que los que daría un schema genérico.
 *
 * Lo que apareció midiendo fue otra cosa, y peor:
 *
 * 1. **Las seis rutas no tenían `asyncHandler`.** En Express 4 un `async` que
 *    rechaza no llega al errorHandler: se va como unhandled rejection, y con
 *    Node 22 eso **termina el proceso**. Un hipo de la base en cualquiera de
 *    ellas tumbaba el backend entero, y el síntoma —el bot deja de responder— no
 *    habría señalado nunca a ese archivo.
 * 2. **`/book` convertía toda excepción en un 500 propio**, tapando la
 *    traducción de errores de entrada que ya existía. Un `serviceId` que no es
 *    UUID daba "Error al registrar el turno": dice "me rompí" cuando lo cierto es
 *    "me mandaste mal los datos".
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';

const KEY = process.env.N8N_API_KEY ?? '';

let serviceId = '';
/** Se lee de la base, no del entorno: es lo que el bridge compara de verdad. */
let TEL = '';

function bridge(metodo: 'get' | 'post', ruta: string) {
  return request(app)[metodo](ruta).set('x-api-key', KEY).set('x-tenant-phone', TEL);
}

beforeAll(async () => {
  const { rows: t } = await db.queryAdmin<{ whatsapp_phone: string }>(
    `SELECT whatsapp_phone FROM tenants WHERE slug = 'el-brillante'`,
  );
  TEL = t[0].whatsapp_phone;

  const { rows } = await db.queryAdmin<{ id: string }>(
    `SELECT id FROM services WHERE tenant_id = (SELECT id FROM tenants WHERE slug='el-brillante')
     AND is_active = true LIMIT 1`,
  );
  serviceId = rows[0].id;
});

afterAll(async () => {
  await db.queryAdmin(`DELETE FROM appointments WHERE source = 'whatsapp' AND notes IS NULL
                       AND created_at > NOW() - INTERVAL '10 minutes'`);
  await db.pool.end();
});

describe('una falla de la base responde, no tumba el proceso', () => {
  it('devuelve 500 en vez de irse como unhandled rejection', async () => {
    // Sin `asyncHandler` esto no daba 500: el rechazo escapaba del manejador de
    // Express y Node terminaba el proceso. Comprobado antes de arreglarlo — el
    // script de sonda moría con el stack de Express y sin responder nada.
    const real = db.query.bind(db);
    const espia = jest
      .spyOn(db, 'query')
      .mockImplementation(async (texto: string, params?: unknown[]) => {
        if (texto.includes('FROM appointments a')) throw new Error('base caída');
        return real(texto, params as never);
      });

    try {
      const res = await bridge('get', '/api/wa-bridge/appointment-status?plate=ABC123');

      expect(res.status).toBe(500);
      expect(res.body.error).toBeTruthy();
    } finally {
      espia.mockRestore();
    }
  });

  it('y el proceso sigue vivo para atender la siguiente', async () => {
    // Lo que de verdad importaba: que el lavadero siga trabajando.
    const res = await bridge('get', '/api/wa-bridge/services');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.services)).toBe(true);
  });
});

const base = { waLid: 'errores@lid', plate: 'ERR123' };

describe('entrada malformada en /book da 400, no 500', () => {

  it('un serviceId que no es UUID', async () => {
    const res = await bridge('post', '/api/wa-bridge/book').send({
      ...base, serviceId: 'no-soy-un-uuid', scheduledAt: '2026-10-01T10:00',
    });

    expect(res.status).toBe(400);
    // El mensaje viene del errorHandler, que sabe qué significa cada código de
    // PostgreSQL. Antes lo tapaba el catch con un "Error al registrar el turno".
    expect(res.body.error).toMatch(/formato/i);
  });

  it('un scheduledAt que no es una fecha', async () => {
    const res = await bridge('post', '/api/wa-bridge/book').send({
      ...base, serviceId, scheduledAt: 'el-martes-que-viene',
    });
    expect(res.status).toBe(400);
  });

  it('un waLid más largo que la columna', async () => {
    const res = await bridge('post', '/api/wa-bridge/book').send({
      waLid: 'X'.repeat(5000), plate: 'ERR124', serviceId, scheduledAt: '2026-10-01T10:00',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/largo/i);
  });
});

describe('lo que ya funcionaba sigue igual', () => {
  // La validación a mano de este módulo resultó mejor de lo que la brecha
  // sugería: da mensajes más útiles que un schema genérico. No se reemplazó.

  it('falta un campo obligatorio: 400 que dice cuáles son', async () => {
    const res = await bridge('post', '/api/wa-bridge/book').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('serviceId');
  });

  it('un servicio que no existe: 404, no 400', async () => {
    // La distinción se mantiene: "no te entendí" ≠ "no está".
    const res = await bridge('post', '/api/wa-bridge/book').send({
      ...base,
      serviceId: '00000000-0000-4000-8000-000000000000',
      scheduledAt: '2026-10-01T10:00',
    });
    expect(res.status).toBe(404);
  });

  it('el lote de auditoría sigue rechazando entrada por entrada', async () => {
    // Que un mensaje venga mal no puede hacer perder los otros: la auditoría es
    // justamente lo que hay que conservar cuando algo va raro.
    // El lote va como `{ mensajes: [...] }`, no como un array suelto. La primera
    // versión de esta prueba mandaba el array pelado y concluía que el módulo
    // estaba roto; lo que estaba mal era la prueba.
    const res = await bridge('post', '/api/wa-bridge/log').send({
      mensajes: [
        { phone: '+573001112233', direction: 'inbound', content: 'este sirve' },
        { direction: 'inventado' },
      ],
    });

    // Con al menos una válida se registra esa y se informa la otra: 201, no 400.
    expect(res.status).toBe(201);
    expect(res.body.registrados).toBe(1);
    expect(res.body.rechazadas).toHaveLength(1);
    expect(res.body.rechazadas[0].indice).toBe(1);
  });

  it('un turno válido se sigue creando', async () => {
    const res = await bridge('post', '/api/wa-bridge/book').send({
      ...base, serviceId, scheduledAt: '2026-10-01T10:00', customerName: 'Prueba Errores',
    });

    expect(res.status).toBe(201);
    expect(res.body.appointment.id).toBeTruthy();
    // El precio sale del servicio, no del cuerpo: mandarlo no cambia nada.
    expect(res.body.appointment.price).toBeGreaterThan(0);
  });
});
