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
import { conTenant } from './helpers/rls';
import { initBooking } from '../src/modules/whatsapp/wa-bridge.booking';
import { accionSolicitada, nombreValido } from '../src/modules/whatsapp/datos-personales';
import { buscarOCrearCliente } from '../src/modules/whatsapp/wa-identity';
import { autorizacionDe } from '../src/modules/whatsapp/consentimiento';

const API_KEY = process.env.N8N_API_KEY as string;
const LID_TITULAR = '99955500011122@lid';
const LID_VECINO = '99955500033344@lid';

let tenantId: string;
let tenantPhone: string;
let redis: Redis;

/**
 * Corre la prueba dentro del contexto de tenant, como lo haría una petición.
 * Con RLS activo, llamar estas funciones sin contexto no ve ninguna fila: las
 * políticas fallan cerrado a propósito. Ver helpers/rls.ts.
 */
const itEnTenant = (nombre: string, fn: () => Promise<void>): void => {
  it(nombre, () => conTenant(tenantId, fn));
};


/** Un mensaje al bridge, como lo manda n8n en cada mensaje entrante. */
function escribir(waLid: string, message: string) {
  return request(app)
    .post('/api/wa-bridge/booking-step')
    .set('x-api-key', API_KEY)
    .set('x-tenant-phone', tenantPhone)
    .send({ waLid, message });
}

async function datosDe(waLid: string) {
  const { rows } = await db.queryAdmin<{
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

  const { rows } = await db.queryAdmin<{ id: string; whatsapp_phone: string }>(
    `SELECT id, whatsapp_phone FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenantId = rows[0].id;
  tenantPhone = rows[0].whatsapp_phone;
});

beforeEach(async () => {
  await redis.flushdb();
  await db.queryAdmin(
    `DELETE FROM customers WHERE tenant_id = $1 AND wa_lid IN ($2, $3)`,
    [tenantId, LID_TITULAR, LID_VECINO],
  );

  // El alta va dentro del contexto del tenant: `buscarOCrearCliente` es código
  // de la aplicación y con RLS activo su INSERT choca contra el `WITH CHECK` si
  // nadie fijó `app.tenant_id`. En producción lo fija `requireTenant`.
  await conTenant(tenantId, async () => {
    await buscarOCrearCliente(
      tenantId, { phone: '+573001119999', waLid: LID_TITULAR },
      'Ana Titular', db.query, autorizacionDe('whatsapp'),
    );
    await buscarOCrearCliente(
      tenantId, { phone: null, waLid: LID_VECINO }, 'Beto Vecino',
    );
  });
});

afterAll(async () => {
  await db.queryAdmin(
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

describe('qué sirve como nombre', () => {
  // Unitario, sin pasar por el bridge: es la segunda línea de defensa del paso
  // de corrección, y probarla por HTTP no la ejercitaría —el despacho atiende
  // las palabras reservadas antes—.
  it('acepta un nombre normal, con tildes y compuesto', () => {
    expect(nombreValido('Ana')).toBe(true);
    expect(nombreValido('María José')).toBe(true);
    expect(nombreValido("O'Brien")).toBe(true);
    expect(nombreValido('Jean-Luc')).toBe(true);
  });

  it('rechaza lo que claramente no es un nombre', () => {
    expect(nombreValido('')).toBe(false);
    expect(nombreValido('A')).toBe(false);
    expect(nombreValido('ABC123')).toBe(false);       // una placa
    expect(nombreValido('+573001234567')).toBe(false); // un teléfono
    expect(nombreValido('x'.repeat(81))).toBe(false);
  });

  it('rechaza las palabras reservadas', () => {
    // Lo que se escriba acá queda como el nombre del titular. Un
    // «BORRAR MIS DATOS» guardado como nombre sería entender al revés.
    expect(nombreValido('BORRAR MIS DATOS')).toBe(false);
    expect(nombreValido('mis datos')).toBe(false);
    expect(nombreValido('confirmo')).toBe(false);
  });
});

describe('derecho de rectificación', () => {
  // El derecho que faltaba: el doc decía "sólo el personal puede corregir", así
  // que ejercerlo dependía de que alguien contestara.

  itEnTenant('pide el nombre nuevo y lo guarda', async () => {
    const pregunta = await escribir(LID_TITULAR, 'CORREGIR MIS DATOS');
    expect(pregunta.body.reply).toContain('Ana Titular');
    expect(pregunta.body.done).toBe(false);

    const hecho = await escribir(LID_TITULAR, 'Ana María Titular');
    expect(hecho.body.done).toBe(true);
    expect(hecho.body.reply).toContain('Ana María Titular');

    expect((await datosDe(LID_TITULAR))?.first_name).toBe('Ana');

    const { rows } = await db.queryAdmin<{ last_name: string }>(
      `SELECT last_name FROM customers WHERE tenant_id = $1 AND wa_lid = $2`,
      [tenantId, LID_TITULAR],
    );
    expect(rows[0].last_name).toBe('María Titular');
  });

  itEnTenant('no pide confirmación: corregir no es borrar', async () => {
    // Asimetría deliberada. El borrado no se deshace y exige CONFIRMO; una
    // corrección de nombre sí se deshace escribiendo otra vez, así que pedir
    // confirmación sería fricción sin nada a cambio.
    await escribir(LID_TITULAR, 'CORREGIR MIS DATOS');
    const hecho = await escribir(LID_TITULAR, 'Anita');

    expect(hecho.body.done).toBe(true);
    expect((await datosDe(LID_TITULAR))?.first_name).toBe('Anita');
  });

  itEnTenant('con 0 se desiste y el nombre queda igual', async () => {
    await escribir(LID_TITULAR, 'CORREGIR MIS DATOS');
    const r = await escribir(LID_TITULAR, '0');

    expect(r.body.done).toBe(true);
    expect(r.body.reply).not.toMatch(/borramos/i);
    expect((await datosDe(LID_TITULAR))?.first_name).toBe('Ana');
  });

  itEnTenant('una palabra reservada se entiende, no se guarda como nombre', async () => {
    // Quien escriba BORRAR MIS DATOS en este paso está pidiendo otra cosa.
    //
    // Lo atiende el despacho, que intercepta las palabras reservadas **antes**
    // de llegar acá: la respuesta es la confirmación del borrado, no una
    // repregunta por el nombre. `nombreValido` las rechaza igual, como segunda
    // línea — eso se prueba aparte, abajo.
    await escribir(LID_TITULAR, 'CORREGIR MIS DATOS');
    const r = await escribir(LID_TITULAR, 'BORRAR MIS DATOS');

    expect(r.body.done).toBe(false);
    expect(r.body.reply).toMatch(/no se puede deshacer|CONFIRMO/i);
    expect((await datosDe(LID_TITULAR))?.first_name).toBe('Ana');
  });

  itEnTenant('algo con números se rechaza y se repregunta', async () => {
    // Una placa o un teléfono tecleados por error no son un nombre.
    await escribir(LID_TITULAR, 'CORREGIR MIS DATOS');
    const r = await escribir(LID_TITULAR, 'ABC123');

    expect(r.body.done).toBe(false);
    expect(r.body.reply).toMatch(/sin n[uú]meros/i);
    expect((await datosDe(LID_TITULAR))?.first_name).toBe('Ana');
  });

  itEnTenant('corrige sólo al que lo pidió, no al vecino', async () => {
    await escribir(LID_TITULAR, 'CORREGIR MIS DATOS');
    await escribir(LID_TITULAR, 'Anita Corregida');

    expect((await datosDe(LID_VECINO))?.first_name).toBe('Beto');
  });

  itEnTenant('el resumen de datos ofrece la corrección', async () => {
    // Antes decía sólo "escribe ASESOR", que es el canal que dependía de que
    // alguien contestara.
    const r = await escribir(LID_TITULAR, 'MIS DATOS');
    expect(r.body.reply).toContain('CORREGIR MIS DATOS');
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

    const { rows } = await db.queryAdmin<{ first_name: string; phone: string | null }>(
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
    const { rows } = await db.queryAdmin<{ id: string }>(
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

    const { rows } = await db.queryAdmin<{ phone: string | null; anonymized_at: Date | null }>(
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
