/**
 * El límite de peticiones de `wa-bridge` es por cliente, no por IP.
 *
 * Sale de un fallo en producción. Todo el tráfico de esta ruta llega desde
 * n8n, que es **una sola IP**, así que el limitador global repartía una cuota
 * de 100 peticiones cada 15 minutos entre *todos* los clientes del lavadero.
 * Unos 20 mensajes la agotaban y el bot dejaba de responderle a cualquiera.
 *
 * El síntoma no delataba la causa: un 429 en `booking-step` hace que n8n crea
 * que no hay conversación en curso y mande el mensaje a Claude, así que se veía
 * como si el agendamiento estuviera roto. Costó tres diagnósticos equivocados.
 *
 * Lo que se prueba es la propiedad que faltaba: **un cliente que se pasa de
 * mensajes no puede dejar sin bot a los demás.**
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';

const API_KEY = process.env.N8N_API_KEY as string;
let tenantPhone: string;

/** Un mensaje cualquiera a la auditoría, que es la ruta más barata de llamar. */
function log(waLid: string) {
  return request(app)
    .post('/api/wa-bridge/log')
    .set('x-api-key', API_KEY)
    .set('x-tenant-phone', tenantPhone)
    .send({ waLid, direction: 'inbound', content: '[test-limite] hola' });
}

beforeAll(async () => {
  const { rows } = await db.query<{ whatsapp_phone: string }>(
    `SELECT whatsapp_phone FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenantPhone = rows[0].whatsapp_phone;
});

afterAll(async () => {
  await db.query(`DELETE FROM whatsapp_messages WHERE content LIKE '[test-limite]%'`);
  await db.pool.end();
});

describe('límite por cliente en wa-bridge', () => {
  it('un cliente que agota su cuota no deja sin servicio a otro', async () => {
    const ahogado = `99911100000${Date.now() % 1000}@lid`;
    const tranquilo = `99911199999${Date.now() % 1000}@lid`;

    // Gastar de sobra la cuota de uno. El tope por defecto es 120.
    let bloqueado = false;
    for (let i = 0; i < 140 && !bloqueado; i++) {
      const r = await log(ahogado);
      if (r.status === 429) bloqueado = true;
    }

    expect(bloqueado).toBe(true);

    // Y ahora el que no ha escrito nada tiene que ser atendido igual. Esta es
    // la aserción que importa: con el limitador por IP daba 429 también.
    const otro = await log(tranquilo);
    expect(otro.status).toBe(201);
  }, 60_000);
});

describe('auditoría por lotes', () => {
  const lid = `99911155555${Date.now() % 1000}@lid`;

  it('registra varios mensajes en una sola petición', async () => {
    const r = await request(app)
      .post('/api/wa-bridge/log')
      .set('x-api-key', API_KEY)
      .set('x-tenant-phone', tenantPhone)
      .send({
        mensajes: [
          { waLid: lid, direction: 'inbound', content: '[test-limite] hola' },
          { waLid: lid, direction: 'outbound', content: '[test-limite] menú' },
        ],
      });

    expect(r.status).toBe(201);
    expect(r.body.registrados).toBe(2);

    const { rows } = await db.query(
      `SELECT direction FROM whatsapp_messages WHERE wa_lid = $1 ORDER BY direction`,
      [lid],
    );
    expect(rows).toHaveLength(2);
  });

  it('sigue aceptando un mensaje suelto, como lo manda el n8n sin actualizar', async () => {
    // El workflow vive fuera del repositorio: si el lote fuera obligatorio, un
    // despliegue del backend dejaría la auditoría muda hasta reimportarlo.
    const r = await request(app)
      .post('/api/wa-bridge/log')
      .set('x-api-key', API_KEY)
      .set('x-tenant-phone', tenantPhone)
      .send({ waLid: `${lid}x`, direction: 'inbound', content: '[test-limite] suelto' });

    expect(r.status).toBe(201);
    expect(r.body.registrados).toBe(1);
  });

  it('una entrada mala no se lleva al resto del lote', async () => {
    // La auditoría es lo que hay que conservar cuando algo va raro: perder los
    // mensajes buenos por uno malformado sería exactamente lo contrario.
    const bueno = `${lid}ok`;
    const r = await request(app)
      .post('/api/wa-bridge/log')
      .set('x-api-key', API_KEY)
      .set('x-tenant-phone', tenantPhone)
      .send({
        mensajes: [
          { direction: 'inbound', content: '[test-limite] sin identidad' },
          { waLid: bueno, direction: 'inbound', content: '[test-limite] válido' },
        ],
      });

    expect(r.status).toBe(201);
    expect(r.body.registrados).toBe(1);
    expect(r.body.rechazadas).toHaveLength(1);
  });

  it('un lote entero inválido sí es un error', async () => {
    const r = await request(app)
      .post('/api/wa-bridge/log')
      .set('x-api-key', API_KEY)
      .set('x-tenant-phone', tenantPhone)
      .send({ mensajes: [{ direction: 'inbound', content: 'sin identidad' }] });

    expect(r.status).toBe(400);
  });
});
