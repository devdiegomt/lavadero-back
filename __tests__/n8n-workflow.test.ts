/**
 * Recorre el workflow real de n8n contra el backend, rama por rama.
 *
 * Complementa a wa-bridge.test.ts: aquel prueba los endpoints directamente,
 * este verifica el contrato entre el workflow y el backend —las URLs que arma,
 * los headers que resuelve, los nombres de campo que leen los formateadores y
 * por qué salida del switch sale cada intención—. Todo eso vive en el JSON del
 * workflow y ninguna otra prueba lo toca.
 *
 * El helper interpreta el JSON como lo haría n8n (Code nodes, expresiones
 * {{ }}, IF, Switch, y el fan-out del nodo HTTP una vez por item). Lo único
 * simulado es la llamada a Claude, que se reemplaza por una respuesta con la
 * forma exacta que devuelve la API de Anthropic.
 *
 * Levanta el servidor en un puerto propio porque el workflow usa URLs
 * absolutas vía $env.BACKEND_URL.
 */
import type { Server } from 'http';
import Redis from 'ioredis';
import app from '../src/index';
import * as db from '../src/shared/db';
import { initBooking } from '../src/modules/whatsapp/wa-bridge.booking';
import { fijarHoraDelTenantEnLaManana } from './helpers/tenant-clock';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runWorkflow, claude } = require('./helpers/n8n-runner');

const PORT = 3999;
const TENANT = '+573223772019';
const CLIENTE = '+573101112233'; // María García, del seed

let server: Server;
let redis: Redis;

interface WFResult {
  reply: string;
  camino: string[];
  calls: { url: string; status?: number; headers: Record<string, string>; body?: string }[];
}

const msg = (message: string, extra: Record<string, unknown> = {}) => ({
  phone: CLIENTE,
  jid: CLIENTE.slice(1) + '@s.whatsapp.net',
  message,
  tenantPhone: TENANT,
  timestamp: new Date().toISOString(),
  messageId: 'WAMSG-' + Math.random().toString(36).slice(2, 10),
  pushName: 'Diego',
  ...extra,
});

const backendCalls = (r: WFResult) => r.calls.filter((c) => c.url.includes('wa-bridge'));

beforeAll(async () => {
  process.env.WF_BACKEND_URL = `http://127.0.0.1:${PORT}`;
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 2 });
  initBooking(redis);

  await db.query(
    `UPDATE tenants SET whatsapp_phone = $1, is_active = true WHERE slug = 'el-brillante'`,
    [TENANT],
  );
  await fijarHoraDelTenantEnLaManana();
  await redis.flushdb();
  await new Promise<void>((ok) => { server = app.listen(PORT, ok); });
});

afterAll(async () => {
  await new Promise<void>((ok) => server.close(() => ok()));
  await redis.quit();
  await db.pool.end();
});

describe('workflow n8n: ramas de intención', () => {
  it('greeting responde el menú sin tocar el backend', async () => {
    const r: WFResult = await runWorkflow(msg('hola buenas'), claude('greeting'));
    expect(r.reply).toMatch(/Bienvenido/);
    expect(r.reply).toContain('Diego'); // usa pushName
    const consultas = backendCalls(r).filter(
      (c) => !c.url.includes('booking-step') && !c.url.includes('/log'),
    );
    expect(consultas).toHaveLength(0);
  });

  it('list_services arma la llamada con headers resueltos', async () => {
    const r: WFResult = await runWorkflow(msg('cuanto cuesta?'), claude('list_services'));
    const svc = backendCalls(r).find((c) => c.url.includes('/services'));
    expect(svc?.status).toBe(200);
    // Las expresiones {{ $env.* }} y {{ ... tenantPhone }} deben resolver
    expect(svc?.headers['x-tenant-phone']).toBe(TENANT);
    expect(svc?.headers['x-api-key']).toBeTruthy();
    expect(r.reply).toMatch(/desde \$/);
    expect(r.reply).not.toMatch(/NaN|undefined/);
  });

  it('check_status sin placa no llama al backend y la pide', async () => {
    const r: WFResult = await runWorkflow(msg('como va mi carro?'), claude('check_status'));
    expect(backendCalls(r).some((c) => c.url.includes('appointment-status'))).toBe(false);
    expect(r.reply).toMatch(/placa/i);
  });

  it('check_status con placa la manda limpia en la URL', async () => {
    const r: WFResult = await runWorkflow(
      msg('como va ABC123?'), claude('check_status', { plate: 'ABC123' }),
    );
    const st = backendCalls(r).find((c) => c.url.includes('appointment-status'));
    expect(st?.status).toBe(200);
    expect(st?.url).toContain('plate=ABC123');
    // Regresión: la placa llegaba como '=ABC123' (%3DABC123)
    expect(st?.url).not.toMatch(/plate=%3D/);
  });

  it('customer_history codifica el teléfono y encuentra al cliente', async () => {
    const r: WFResult = await runWorkflow(msg('mis visitas?'), claude('customer_history'));
    const h = backendCalls(r).find((c) => c.url.includes('customer-history'));
    expect(h?.status).toBe(200);
    expect(h?.url).toContain(encodeURIComponent(CLIENTE));
    expect(r.reply).toMatch(/María/);
    expect(r.reply).not.toMatch(/NaN|undefined/);
  });

  it('human_help y unknown responden sus textos', async () => {
    const humano: WFResult = await runWorkflow(msg('hablar con alguien'), claude('human_help'));
    expect(humano.reply).toMatch(/asesor/i);
    const raro: WFResult = await runWorkflow(msg('asdfghjkl'), claude('unknown'));
    expect(raro.reply).toMatch(/No entend/);
  });
});

describe('workflow n8n: agendamiento multi-turno', () => {
  const nuevo = '+573995554433';
  const conv = (t: string) => msg(t, { phone: nuevo, pushName: 'Cliente Nuevo' });

  it('completa la conversación y crea el turno', async () => {
    let r: WFResult = await runWorkflow(conv('quiero agendar'), claude('book_appointment'));
    expect(backendCalls(r).some(
      (c) => c.url.includes('booking-step') && c.body?.includes('"start":true'),
    )).toBe(true);
    expect(r.reply).toMatch(/placa/i);

    // A partir de acá el mensaje NO debe pasar por Claude: hay sesión abierta,
    // y "ABC123" o "1" son respuestas al paso anterior, no intenciones nuevas.
    r = await runWorkflow(conv('ABC123'), claude('unknown'));
    expect(r.camino).not.toContain('Preparar Solicitud Claude');
    expect(r.reply).toContain('ABC123');

    r = await runWorkflow(conv('1'), claude('unknown'));
    expect(r.camino).not.toContain('Preparar Solicitud Claude');
    expect(r.reply).toMatch(/horarios/i);

    r = await runWorkflow(conv('1'), claude('unknown'));
    expect(r.reply).toMatch(/confirm/i);

    r = await runWorkflow(conv('SI'), claude('unknown'));
    expect(r.reply).toMatch(/agendado/i);

    const { rows } = await db.query<{ price: string; source: string; customer_id: string }>(
      `SELECT a.price, a.source, a.customer_id
       FROM appointments a
       WHERE a.source = 'whatsapp' ORDER BY a.created_at DESC LIMIT 1`,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].price)).toBeGreaterThan(0);
    expect(rows[0].customer_id).toBeTruthy();
  });
});

describe('workflow n8n: auditoría', () => {
  it('registra el entrante y el saliente de un mismo intercambio', async () => {
    const messageId = 'AUDIT-' + Date.now();
    const antes = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM whatsapp_messages WHERE external_id = $1`, [messageId],
    );
    expect(Number(antes.rows[0].n)).toBe(0);

    await runWorkflow(msg('hola', { messageId }), claude('greeting'));

    // El Code node emite dos items y el nodo HTTP corre una vez por cada uno.
    const { rows } = await db.query<{ direction: string; flow_step: string }>(
      `SELECT direction, flow_step FROM whatsapp_messages
       WHERE external_id = $1 ORDER BY direction`, [messageId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => x.direction).sort()).toEqual(['inbound', 'outbound']);
    expect(rows.every((x) => x.flow_step === 'greeting')).toBe(true);
  });

  it('en la rama de agendamiento registra flow_step booking', async () => {
    const messageId = 'AUDIT-BK-' + Date.now();
    const phone = '+573991112200';
    await runWorkflow(
      msg('agendar', { phone, messageId }), claude('book_appointment'),
    );
    // El segundo mensaje ya no pasa por Claude, así que no hay intención:
    // la auditoría debe tolerar que 'Parsear Intencion' no se haya ejecutado.
    const id2 = messageId + '-2';
    await runWorkflow(msg('XYZ111', { phone, messageId: id2 }), claude('unknown'));

    const { rows } = await db.query<{ flow_step: string }>(
      `SELECT DISTINCT flow_step FROM whatsapp_messages WHERE external_id = $1`, [id2],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].flow_step).toBe('booking');
  });
});

describe('workflow n8n: backend inalcanzable', () => {
  // Reproduce el fallo real: n8n no resolvia el DNS del backend y los nodos
  // de consulta, al no tener onError, mataban el workflow antes de responder.
  // El cliente no recibia nada.
  const sinBackend = async (fn: () => Promise<WFResult>): Promise<WFResult> => {
    const previo = process.env.WF_BACKEND_URL;
    process.env.WF_BACKEND_URL = 'http://host-que-no-existe.invalid:3000';
    try {
      return await fn();
    } finally {
      process.env.WF_BACKEND_URL = previo;
    }
  };

  it('check_status responde aunque el backend no resuelva', async () => {
    const r = await sinBackend(() =>
      runWorkflow(msg('como va ABC123?'), claude('check_status', { plate: 'ABC123' })),
    );
    expect(r.reply).toBeTruthy();
    expect(r.reply).toMatch(/no pude consultar/i);
  });

  it('list_services responde aunque el backend no resuelva', async () => {
    const r = await sinBackend(() =>
      runWorkflow(msg('precios'), claude('list_services')),
    );
    expect(r.reply).toBeTruthy();
    expect(r.reply).toMatch(/no pude consultar/i);
  });

  it('customer_history responde aunque el backend no resuelva', async () => {
    const r = await sinBackend(() =>
      runWorkflow(msg('mis visitas'), claude('customer_history')),
    );
    expect(r.reply).toBeTruthy();
    expect(r.reply).toMatch(/no pude consultar/i);
  });

  it('ninguna rama deja al cliente sin respuesta', async () => {
    const intents: [string, string][] = [
      ['greeting', 'hola'],
      ['check_status', 'estado ABC123'],
      ['list_services', 'precios'],
      ['customer_history', 'mis visitas'],
      ['book_appointment', 'agendar'],
      ['human_help', 'asesor'],
      ['unknown', 'asdf'],
    ];
    for (const [intent, texto] of intents) {
      const r = await sinBackend(() =>
        runWorkflow(msg(texto), claude(intent, intent === 'check_status' ? { plate: 'ABC123' } : {})),
      );
      // Lo que importa no es el texto sino que exista: un reply vacio es
      // silencio del lado del cliente.
      expect({ intent, reply: r.reply }).toEqual({ intent, reply: expect.any(String) });
      expect(r.reply.length).toBeGreaterThan(0);
    }
  });
});
