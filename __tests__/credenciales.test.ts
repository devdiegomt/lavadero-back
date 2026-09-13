/**
 * El cifrado de credenciales, forzado.
 *
 * La brecha era ésta: `decryptIfNeeded` aceptaba texto plano y lo devolvía tal
 * cual. Una credencial de facturación podía quedarse sin cifrar para siempre y
 * el sistema funcionaba igual, **sin que nada avisara**. Un cifrado opcional no
 * es una medida de seguridad, es una intención.
 *
 * Y faltaba la otra mitad: no había dónde escribirla cifrada. La única vía era
 * un UPDATE por SQL, que es exactamente cómo terminan en texto plano.
 *
 * Estas pruebas cubren las dos, más lo que tiene que seguir siendo cierto: que
 * el valor no se devuelva nunca por la API.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';
import {
  encrypt,
  decrypt,
  isEncrypted,
  descifrarCredencial,
  CredencialIlegible,
} from '../src/shared/utils/crypto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createAlegraClientForTenant } = require('../src/modules/billing/alegra.client');

const EMAIL = 'contabilidad@elbrillante.co';
const TOKEN = 'alegra-token-de-prueba-1234';

let tenantId: string;
let token: string;
let original: { provider: string | null; key: string | null };

beforeAll(async () => {
  const { rows } = await db.queryAdmin<{ id: string; billing_provider: string | null; billing_api_key: string | null }>(
    `SELECT id, billing_provider, billing_api_key FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenantId = rows[0].id;
  original = { provider: rows[0].billing_provider, key: rows[0].billing_api_key };

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@elbrillante.co', password: 'admin123' });
  token = login.body.accessToken;
  expect(token).toBeTruthy();
});

afterAll(async () => {
  // Dejar el tenant como estaba: otras suites leen esta misma fila.
  await db.queryAdmin(
    `UPDATE tenants SET billing_provider = $1, billing_api_key = $2 WHERE id = $3`,
    [original.provider, original.key, tenantId],
  );
  await db.pool.end();
});

describe('leer una credencial exige que esté cifrada', () => {
  it('una cifrada se descifra', () => {
    const guardado = encrypt(`${EMAIL}:${TOKEN}`);
    expect(isEncrypted(guardado)).toBe(true);
    expect(descifrarCredencial(guardado, 'billing_api_key')).toBe(`${EMAIL}:${TOKEN}`);
  });

  it('una en texto plano ya no pasa de largo: falla y dice qué correr', () => {
    // Esto es la brecha. Antes devolvía el valor y todo seguía funcionando.
    let error: Error | null = null;
    try {
      descifrarCredencial(`${EMAIL}:${TOKEN}`, 'billing_api_key');
    } catch (err) {
      error = err as Error;
    }

    expect(error).toBeInstanceOf(CredencialIlegible);
    expect(error?.message).toContain('texto plano');
    // El mensaje tiene que traer el arreglo, no sólo el diagnóstico: quien lo
    // lee está en producción con las facturas caídas.
    expect(error?.message).toContain('db:encrypt-billing-keys');
  });

  it('si la clave no es la que cifró, lo dice en vez de soltar un error de GCM', () => {
    const guardado = encrypt('algo:secreto') as string;

    let error: Error | null = null;
    try {
      descifrarCredencialConOtraClave(guardado);
    } catch (err) {
      error = err as Error;
    }

    expect(error).not.toBeNull();
    // El error crudo de AES-GCM ("unable to authenticate data") no le dice nada
    // a nadie; el mensaje tiene que nombrar las dos causas reales.
    expect(error?.message).toContain('ENCRYPTION_KEY');
    expect(error?.message).toMatch(/rot/);
    // Y no confundir este caso con el de texto plano, que se arregla distinto.
    expect(error?.message).not.toContain('texto plano');
  });

  it('sin credencial no hay error: null es no configurado, no roto', () => {
    expect(descifrarCredencial(null)).toBeNull();
    expect(descifrarCredencial('')).toBeNull();
    expect(descifrarCredencial(undefined)).toBeNull();
  });

  it('el cliente de Alegra se niega a usar una credencial en texto plano', async () => {
    await db.queryAdmin(
      `UPDATE tenants SET billing_provider = 'alegra', billing_api_key = $1 WHERE id = $2`,
      [`${EMAIL}:${TOKEN}`, tenantId],
    );

    const { rows } = await db.queryAdmin(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
    expect(() => createAlegraClientForTenant(rows[0])).toThrow(CredencialIlegible);
  });
});

/** Descifra con una clave distinta, para provocar el fallo de autenticación. */
function descifrarCredencialConOtraClave(guardado: string): string | null {
  const anterior = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'f'.repeat(64);
  try {
    // `crypto.ts` memoiza la clave, así que hay que pedir el módulo de nuevo
    // para que la lea otra vez. Sin esto la prueba pasaría sin probar nada.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fresco = require('../src/shared/utils/crypto');
    return fresco.descifrarCredencial(guardado, 'billing_api_key');
  } finally {
    process.env.ENCRYPTION_KEY = anterior;
    jest.resetModules();
  }
}

describe('escribir una credencial la cifra', () => {
  it('PUT /config/credentials la guarda cifrada, nunca en claro', async () => {
    const res = await request(app)
      .put('/api/billing/config/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: EMAIL, token: TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.credencialCifrada).toBe(true);

    const { rows } = await db.queryAdmin<{ billing_api_key: string; billing_provider: string }>(
      `SELECT billing_api_key, billing_provider FROM tenants WHERE id = $1`, [tenantId],
    );

    // Lo que importa: en la base no está el token legible.
    expect(rows[0].billing_api_key).not.toContain(TOKEN);
    expect(isEncrypted(rows[0].billing_api_key)).toBe(true);
    expect(decrypt(rows[0].billing_api_key)).toBe(`${EMAIL}:${TOKEN}`);
    expect(rows[0].billing_provider).toBe('alegra');
  });

  it('la respuesta no devuelve la credencial, ni cifrada', async () => {
    const res = await request(app)
      .put('/api/billing/config/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: EMAIL, token: TOKEN });

    const cuerpo = JSON.stringify(res.body);
    expect(cuerpo).not.toContain(TOKEN);
    expect(cuerpo).not.toContain('billing_api_key');
  });

  it('avisa cuando Alegra no respondió, en vez de dar por bueno el guardado', async () => {
    // No hay Alegra en las pruebas, así que este es el camino que se recorre.
    // Importa que lo diga: una credencial mal copiada guardada en silencio se
    // descubre recién cuando falla la primera factura.
    const res = await request(app)
      .put('/api/billing/config/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: EMAIL, token: TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.conexionOk).toBe(false);
    expect(res.body.advertencia).toMatch(/Alegra/);
  });

  it('un token que parece incompleto se rechaza con 400', async () => {
    const res = await request(app)
      .put('/api/billing/config/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: EMAIL, token: 'corto' });

    expect(res.status).toBe(400);
  });

  it('un token con ":" se rechaza: partiría mal el formato guardado', async () => {
    const res = await request(app)
      .put('/api/billing/config/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: EMAIL, token: 'tiene:dos:puntos:y:mas' });

    expect(res.status).toBe(400);
  });

  it('un email inválido se rechaza con 400', async () => {
    const res = await request(app)
      .put('/api/billing/config/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'no-es-un-email', token: TOKEN });

    expect(res.status).toBe(400);
  });
});

describe('GET /config dice si está cifrada', () => {
  it('lo reporta sin exponer el valor', async () => {
    await db.queryAdmin(
      `UPDATE tenants SET billing_provider = 'alegra', billing_api_key = $1 WHERE id = $2`,
      [encrypt(`${EMAIL}:${TOKEN}`), tenantId],
    );

    const res = await request(app)
      .get('/api/billing/config')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.credencialCifrada).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });

  it('marca en falso la que está en texto plano, para que se vea', async () => {
    // El punto de la brecha era que nadie se enteraba. Ahora el panel puede.
    await db.queryAdmin(
      `UPDATE tenants SET billing_provider = 'alegra', billing_api_key = $1 WHERE id = $2`,
      [`${EMAIL}:${TOKEN}`, tenantId],
    );

    const res = await request(app)
      .get('/api/billing/config')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.credencialCifrada).toBe(false);
  });
});
