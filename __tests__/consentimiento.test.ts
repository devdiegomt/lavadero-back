/**
 * Autorización de tratamiento de datos (Ley 1581 de 2012).
 *
 * La ley pide que la autorización sea previa, expresa e informada. Las tres
 * condiciones se prueban acá:
 *
 * - *previa*: el paso de consentimiento va antes del alta del cliente
 * - *expresa*: sólo un sí explícito autoriza; el silencio y "seguir la
 *   conversación" no cuentan
 * - *informada*: queda registrada la versión del aviso que se le mostró
 */
import * as db from '../src/shared/db';
import {
  interpretarRespuesta,
  autorizacionDe,
  textoAutorizacion,
  VERSION_AVISO,
  TEXTO_RECHAZO,
  TEXTO_REPREGUNTA,
} from '../src/modules/whatsapp/consentimiento';
import { buscarOCrearCliente } from '../src/modules/whatsapp/wa-identity';
import { clientesSinAutorizacion } from '../src/shared/db/retencion';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const booking = require('../src/modules/whatsapp/flows/booking');

const LID_CONSENT = '99900011122233@lid';
const LID_SIN_CONSENT = '99900011122244@lid';
/** Distinto de los anteriores: las pruebas del flujo comprueban que NO se cree nada. */
const LID_FLUJO = '99900011122255@lid';

let tenantId: string;
let tenant: { id: string; name: string; timezone?: string };

beforeAll(async () => {
  const { rows } = await db.query<{ id: string; name: string; timezone: string }>(
    `SELECT id, name, timezone FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenantId = rows[0].id;
  tenant = rows[0];
  await db.query(`DELETE FROM customers WHERE tenant_id = $1 AND wa_lid IN ($2, $3, $4)`, [
    tenantId,
    LID_CONSENT,
    LID_SIN_CONSENT,
    LID_FLUJO,
  ]);
});

afterAll(async () => {
  await db.query(`DELETE FROM customers WHERE tenant_id = $1 AND wa_lid IN ($2, $3, $4)`, [
    tenantId,
    LID_CONSENT,
    LID_SIN_CONSENT,
    LID_FLUJO,
  ]);
  await db.pool.end();
});

describe('interpretación de la respuesta', () => {
  it('acepta un sí explícito, con o sin tilde y con puntuación', () => {
    for (const t of ['si', 'Sí', 'SI!', 'acepto', 'Autorizo', 'ok', ' dale ']) {
      expect(interpretarRespuesta(t)).toBe('acepta');
    }
  });

  it('reconoce la negativa', () => {
    for (const t of ['no', 'No.', 'NEL', 'cancelar']) {
      expect(interpretarRespuesta(t)).toBe('rechaza');
    }
  });

  it('no toma por autorización el seguir conversando', () => {
    // Esto es el corazón del requisito de que sea *expresa*: si el titular
    // manda cualquier otra cosa, no autorizó. Volver a preguntar es la única
    // salida válida.
    for (const t of ['bueno pero cuánto sale', 'mañana a las 10', '', '   ', 'sí quiero un lavado']) {
      expect(interpretarRespuesta(t)).toBe('ambiguo');
    }
  });

  it('el aviso dice qué se guarda, para qué y cómo ejercer los derechos', () => {
    const texto = textoAutorizacion('Lavadero El Brillante');
    expect(texto).toContain('Lavadero El Brillante');
    expect(texto.toLowerCase()).toContain('vehículo');
    expect(texto.toLowerCase()).toContain('turnos');
    // ASESOR y no otra palabra: es la que el bot enruta de verdad
    // (intent human_help). Ver el comentario en consentimiento.ts.
    expect(texto).toContain('ASESOR');
  });

  it('la autorización viaja con la versión del aviso vigente', () => {
    const a = autorizacionDe('whatsapp');
    expect(a.consentVersion).toBe(VERSION_AVISO);
    expect(a.consentSource).toBe('whatsapp');
    expect(a.consentAt).toBeInstanceOf(Date);
  });
});

describe('constancia en la base', () => {
  it('guarda cuándo, con qué texto y por qué canal autorizó', async () => {
    const autorizacion = autorizacionDe('whatsapp');
    const id = await buscarOCrearCliente(
      tenantId,
      { phone: null, waLid: LID_CONSENT },
      'Ana Autorizada',
      db.query,
      autorizacion,
    );

    const { rows } = await db.query<{
      consent_at: Date | null;
      consent_version: string | null;
      consent_source: string | null;
    }>(`SELECT consent_at, consent_version, consent_source FROM customers WHERE id = $1`, [id]);

    // Poder demostrar la autorización es lo que pide la ley; afirmarla no basta.
    expect(rows[0].consent_at).toBeInstanceOf(Date);
    expect(rows[0].consent_version).toBe(VERSION_AVISO);
    expect(rows[0].consent_source).toBe('whatsapp');
  });

  it('un alta sin autorización queda marcada como tal, no se inventa una', async () => {
    const id = await buscarOCrearCliente(
      tenantId,
      { phone: null, waLid: LID_SIN_CONSENT },
      'Beto SinConsentimiento',
    );

    const { rows } = await db.query<{ consent_at: Date | null }>(
      `SELECT consent_at FROM customers WHERE id = $1`,
      [id],
    );
    expect(rows[0].consent_at).toBeNull();

    // Y aparece en el reporte del pasivo pendiente de regularizar.
    expect(await clientesSinAutorizacion(tenantId)).toBeGreaterThan(0);
  });
});

describe('el paso en la conversación', () => {
  // Función y no constante: `tenant` se resuelve en beforeAll, que corre
  // después de que se evalúa el cuerpo del describe.
  const ctx = (step: string, text: string, data?: Record<string, unknown>) => ({
    tenant,
    phone: null,
    waLid: LID_FLUJO,
    text,
    session: {
      step,
      data: data ?? { plate: 'XYZ123', firstName: 'Ana', lastName: 'Autorizada' },
    },
  });

  it('tras el nombre pregunta por la autorización, no por el vehículo', async () => {
    const r = await booking.handle(ctx('awaiting_name', 'Ana Autorizada', { plate: 'XYZ123' }));

    // El alta del cliente ocurre recién en awaiting_vehicle_type: preguntar
    // antes es lo que hace que la autorización sea *previa*.
    expect(r.nextStep).toBe('awaiting_consent');
    expect(r.messages.join('\n')).toContain('ASESOR');
  });

  it('si no autoriza, el flujo termina y no se guarda nada', async () => {
    const r = await booking.handle(ctx('awaiting_consent', 'no'));

    expect(r.nextFlow).toBeNull();
    expect(r.nextStep).toBeNull();
    expect(r.messages[0]).toBe(TEXTO_RECHAZO);

    const { rows } = await db.query(
      `SELECT id FROM customers WHERE tenant_id = $1 AND wa_lid = $2`,
      [tenantId, LID_FLUJO],
    );
    expect(rows).toHaveLength(0);
  });

  it('ante una respuesta ambigua repregunta en vez de asumir que sí', async () => {
    const r = await booking.handle(ctx('awaiting_consent', 'y cuánto cuesta?'));

    expect(r.nextStep).toBe('awaiting_consent');
    expect(r.messages[0]).toBe(TEXTO_REPREGUNTA);
    expect(r.data.autorizacion).toBeUndefined();
  });

  it('con el sí sigue al vehículo llevando la constancia en la sesión', async () => {
    const r = await booking.handle(ctx('awaiting_consent', 'SI'));

    expect(r.nextStep).toBe('awaiting_vehicle_type');
    expect(r.data.autorizacion.consentVersion).toBe(VERSION_AVISO);
    expect(r.data.autorizacion.consentSource).toBe('whatsapp');
  });
});
