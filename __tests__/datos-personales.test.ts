/**
 * Derechos del titular sobre sus datos (Ley 1581): acceso y supresión.
 *
 * Cierra la brecha 6 de [Seguridad §7](../docs/05-seguridad.md): `anonimizarCliente()`
 * existía pero el titular no tenía forma de ejercerla — el aviso lo derivaba a
 * un asesor, que es válido pero manual.
 *
 * Lo que más se prueba acá no es que borre, sino **cuándo se niega a borrar**.
 * El borrado es irreversible: un falso positivo destruye los datos de alguien
 * que no lo pidió, y eso no se arregla con un despliegue.
 */
import request from 'supertest';
import Redis from 'ioredis';
import app from '../src/index';
import * as db from '../src/shared/db';
import { initBooking } from '../src/modules/whatsapp/wa-bridge.booking';
import { accionSolicitada } from '../src/modules/whatsapp/datos-personales';
import { buscarOCrearCliente } from '../src/modules/whatsapp/wa-identity';
import { autorizacionDe } from '../src/modules/whatsapp/consentimiento';

const API_KEY = process.env.N8N_API_KEY as string;
const LID_TITULAR = '99955500011122@lid';
const LID_VECINO = '99955500033344@lid';

let tenantId: string;
let tenantPhone: string;
let redis: Redis;

/** Un mensaje al bridge, como lo manda n8n en cada mensaje entrante. */
function escribir(waLid: string, message: string) {
  return request(app)
    .post('/api/wa-bridge/booking-step')
    .set('x-api-key', API_KEY)
    .set('x-tenant-phone', tenantPhone)
    .send({ waLid, message });
}

async function datosDe(waLid: string) {
  const { rows } = await db.query<{
    first_name: string; phone: string | null; anonymized_at: Date | null;
  }>(
    `SELECT first_name, phone, anonymized_at FROM customers
     WHERE tenant_id = $1 AND wa_lid = $2`,
    [tenantId, waLid],
  );
  return rows[0] ?? null;
}

beforeAll(async () => {
  // index.ts no inicializa Redis con NODE_ENV=test, así que se hace acá.
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 2 });
  initBooking(redis);

  const { rows } = await db.query<{ id: string; whatsapp_phone: string }>(
    `SELECT id, whatsapp_phone FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenantId = rows[0].id;
  tenantPhone = rows[0].whatsapp_phone;
});

beforeEach(async () => {
  await redis.flushdb();
  await db.query(
    `DELETE FROM customers WHERE tenant_id = $1 AND wa_lid IN ($2, $3)`,
    [tenantId, LID_TITULAR, LID_VECINO],
  );
  await buscarOCrearCliente(
    tenantId, { phone: '+573001119999', waLid: LID_TITULAR },
    'Ana Titular', db.query, autorizacionDe('whatsapp'),
  );
  await buscarOCrearCliente(
    tenantId, { phone: null, waLid: LID_VECINO }, 'Beto Vecino',
  );
});

afterAll(async () => {
  await db.query(
    `DELETE FROM customers WHERE tenant_id = $1
       AND (wa_lid IN ($2, $3) OR (anonymized_at IS NOT NULL AND phone IS NULL AND wa_lid IS NULL))`,
    [tenantId, LID_TITULAR, LID_VECINO],
  );
  await redis.quit();
  await db.pool.end();
});

describe('qué cuenta como una petición de datos', () => {
  it('reconoce las frases de acceso y de borrado', () => {
    expect(accionSolicitada('MIS DATOS')).toBe('acceso');
    expect(accionSolicitada('  mis  datos ')).toBe('acceso');
    expect(accionSolicitada('BORRAR MIS DATOS')).toBe('supresion');
    expect(accionSolicitada('eliminar mis datos')).toBe('supresion');
    expect(accionSolicitada('Confirmo.')).toBe('confirmacion');
  });

  it('no confunde una negación con una petición de borrado', () => {
    // Coincidencia por subcadena convertiría esto en un borrado. Es
    // exactamente el error que no se puede cometer con algo irreversible.
    expect(accionSolicitada('no quiero que borren mis datos')).toBeNull();
    expect(accionSolicitada('gracias por no borrar mis datos')).toBeNull();
  });

  it('un mensaje normal no es una petición de datos', () => {
    for (const t of ['hola', 'agendar un turno', 'ABC123', '', '   ']) {
      expect(accionSolicitada(t)).toBeNull();
    }
  });
});

describe('derecho de acceso', () => {
  it('le muestra qué se guarda de él, sin borrar nada', async () => {
    const r = await escribir(LID_TITULAR, 'MIS DATOS');

    expect(r.status).toBe(200);
    expect(r.body.reply).toContain('Ana Titular');
    expect(r.body.reply).toContain('BORRAR MIS DATOS');

    // Consultar no modifica.
    expect((await datosDe(LID_TITULAR))?.anonymized_at).toBeNull();
  });

  it('a quien no tiene datos se lo dice, en vez de inventar un resumen', async () => {
    const r = await escribir('99955500099999@lid', 'MIS DATOS');
    expect(r.body.reply).toContain('No tenemos datos tuyos');
  });
});

describe('derecho de supresión', () => {
  it('pedirlo NO borra: primero avisa y pide confirmación', async () => {
    const r = await escribir(LID_TITULAR, 'BORRAR MIS DATOS');

    expect(r.body.reply).toContain('no se puede deshacer');
    expect(r.body.reply).toContain('CONFIRMO');
    // Lo esencial: sigue todo en su sitio.
    const antes = await datosDe(LID_TITULAR);
    expect(antes?.anonymized_at).toBeNull();
    expect(antes?.phone).toBe('+573001119999');
  });

  it('con el CONFIRMO sí borra', async () => {
    await escribir(LID_TITULAR, 'BORRAR MIS DATOS');
    const r = await escribir(LID_TITULAR, 'CONFIRMO');

    expect(r.body.reply).toContain('borramos tus datos');

    const { rows } = await db.query<{ first_name: string; phone: string | null }>(
      `SELECT first_name, phone FROM customers
       WHERE tenant_id = $1 AND anonymized_at IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId],
    );
    expect(rows[0].first_name).toBe('Cliente');
    expect(rows[0].phone).toBeNull();
  });

  it('un CONFIRMO suelto, sin haberlo pedido, no borra nada', async () => {
    // El caso que más daño haría: alguien confirmando otra cosa —o un mensaje
    // rezagado— no puede disparar un borrado.
    const r = await escribir(LID_TITULAR, 'CONFIRMO');

    expect(r.body.active).toBe(false); // sigue el camino normal, no lo secuestra
    expect((await datosDe(LID_TITULAR))?.anonymized_at).toBeNull();
  });

  it('desistir con 0 deja los datos intactos', async () => {
    await escribir(LID_TITULAR, 'BORRAR MIS DATOS');
    const r = await escribir(LID_TITULAR, '0');

    expect(r.body.reply).toContain('no borramos nada');
    expect((await datosDe(LID_TITULAR))?.anonymized_at).toBeNull();
  });

  it('ante una respuesta ambigua repregunta, no interpreta', async () => {
    await escribir(LID_TITULAR, 'BORRAR MIS DATOS');
    const r = await escribir(LID_TITULAR, 'bueno');

    expect(r.body.reply).toContain('respuesta clara');
    expect((await datosDe(LID_TITULAR))?.anonymized_at).toBeNull();
  });

  it('borra sólo al que lo pidió, no a otro cliente del mismo lavadero', async () => {
    await escribir(LID_TITULAR, 'BORRAR MIS DATOS');
    await escribir(LID_TITULAR, 'CONFIRMO');

    const vecino = await datosDe(LID_VECINO);
    expect(vecino?.anonymized_at).toBeNull();
    expect(vecino?.first_name).toBe('Beto');
  });
});

describe('supresión desde el panel', () => {
  // Cuando el titular lo pide por teléfono, en el local, o por correo: no todo
  // el mundo ejerce sus derechos por WhatsApp.
  let token: string;

  beforeAll(async () => {
    const r = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@elbrillante.co', password: 'admin123' });
    token = (r.body as { accessToken: string }).accessToken;
  });

  async function idDe(waLid: string): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM customers WHERE tenant_id = $1 AND wa_lid = $2`,
      [tenantId, waLid],
    );
    return rows[0].id;
  }

  it('suprime los datos y lo dice', async () => {
    const id = await idDe(LID_TITULAR);
    const r = await request(app)
      .post(`/api/customers/${id}/anonimizar`)
      .set('Authorization', `Bearer ${token}`);

    expect(r.status).toBe(200);
    expect(r.body.anonimizado).toBe(true);

    const { rows } = await db.query<{ phone: string | null; anonymized_at: Date | null }>(
      `SELECT phone, anonymized_at FROM customers WHERE id = $1`, [id],
    );
    expect(rows[0].phone).toBeNull();
    expect(rows[0].anonymized_at).not.toBeNull();
  });

  it('repetirlo no es un error, avisa que ya estaba hecho', async () => {
    const id = await idDe(LID_TITULAR);
    await request(app).post(`/api/customers/${id}/anonimizar`)
      .set('Authorization', `Bearer ${token}`);
    const r = await request(app).post(`/api/customers/${id}/anonimizar`)
      .set('Authorization', `Bearer ${token}`);

    expect(r.status).toBe(200);
    expect(r.body.anonimizado).toBe(false);
  });

  it('un id de otro tenant no se toca: 404, no un borrado silencioso', async () => {
    const r = await request(app)
      .post('/api/customers/00000000-0000-0000-0000-000000000000/anonimizar')
      .set('Authorization', `Bearer ${token}`);

    expect(r.status).toBe(404);
  });

  it('sin autenticar no se puede', async () => {
    const id = await idDe(LID_VECINO);
    const r = await request(app).post(`/api/customers/${id}/anonimizar`);
    expect(r.status).toBe(401);
  });
});

describe('el derecho no depende de la IA ni de una conversación en curso', () => {
  it('funciona sin sesión previa y sin pasar por el clasificador', async () => {
    // Es un derecho que la ley obliga a atender: si dependiera del intent,
    // Claude caído o sin crédito lo dejaría sin atender. Ver ADR-0006.
    const r = await escribir(LID_TITULAR, 'MIS DATOS');

    expect(r.body.active).toBe(true);
    expect(r.body.reply).toBeTruthy();
  });
});
