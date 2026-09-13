/**
 * Identificación de clientes por LID de WhatsApp.
 *
 * WhatsApp multi-device no entrega el teléfono: la key del mensaje trae sólo
 * el @lid y contacts.upsert nunca dispara. Comprobado en producción con
 * camposKey = { remoteJid, fromMe, id }. El LID pasa a ser el identificador.
 */
import * as db from '../src/shared/db';
import { conTenant } from './helpers/rls';
import {
  leerIdentidad,
  tieneIdentidad,
  claveSesion,
  buscarCliente,
  buscarOCrearCliente,
} from '../src/modules/whatsapp/wa-identity';

const LID = '16733343588585@lid';
let tenantId: string;

/**
 * Una prueba que corre dentro del contexto de tenant, como lo haría una
 * petición. Sin esto, con RLS activo estas funciones no ven ninguna fila: las
 * políticas fallan cerrado a propósito. Ver helpers/rls.ts.
 */
const itEnTenant = (nombre: string, fn: () => Promise<void>): void => {
  it(nombre, () => conTenant(tenantId, fn));
};

beforeAll(async () => {
  const { rows } = await db.queryAdmin<{ id: string }>(
    `SELECT id FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenantId = rows[0].id;
});

afterAll(async () => {
  await db.queryAdmin(`DELETE FROM customers WHERE wa_lid LIKE '%@lid' AND tenant_id = $1`, [tenantId]);
  await db.pool.end();
});

describe('lectura de identidad', () => {
  it('descarta cadenas vacías', () => {
    expect(leerIdentidad({ phone: '  ', waLid: '' })).toEqual({ phone: null, waLid: null });
  });

  it('recorta espacios', () => {
    expect(leerIdentidad({ waLid: ` ${LID} ` })).toEqual({ phone: null, waLid: LID });
  });

  it('hace falta al menos una', () => {
    expect(tieneIdentidad({ phone: null, waLid: null })).toBe(false);
    expect(tieneIdentidad({ phone: null, waLid: LID })).toBe(true);
    expect(tieneIdentidad({ phone: '+573001112233', waLid: null })).toBe(true);
  });

  it('la sesión se llavea por LID cuando existe', () => {
    // Es lo estable entre mensajes; el teléfono puede no venir.
    expect(claveSesion({ phone: '+573001112233', waLid: LID })).toBe(LID);
    expect(claveSesion({ phone: '+573001112233', waLid: null })).toBe('+573001112233');
  });
});

describe('alta y búsqueda de clientes', () => {
  itEnTenant('crea un cliente sólo con LID, sin teléfono', async () => {
    const id = await buscarOCrearCliente(tenantId, { phone: null, waLid: LID }, 'Diego Mayorga');
    expect(id).toBeTruthy();

    const { rows } = await db.queryAdmin<{ phone: string | null; wa_lid: string; first_name: string; last_name: string }>(
      `SELECT phone, wa_lid, first_name, last_name FROM customers WHERE id = $1`, [id],
    );
    expect(rows[0].phone).toBeNull();          // phone dejó de ser NOT NULL
    expect(rows[0].wa_lid).toBe(LID);
    expect(rows[0].first_name).toBe('Diego');
    expect(rows[0].last_name).toBe('Mayorga');
  });

  itEnTenant('el mismo LID devuelve el mismo cliente, no uno nuevo', async () => {
    const a = await buscarOCrearCliente(tenantId, { phone: null, waLid: LID }, 'Diego');
    const b = await buscarOCrearCliente(tenantId, { phone: null, waLid: LID }, 'Otro Nombre');
    expect(b).toBe(a);
  });

  itEnTenant('lo encuentra por LID', async () => {
    const id = await buscarOCrearCliente(tenantId, { phone: null, waLid: LID }, 'Diego');
    const c = await buscarCliente(tenantId, { phone: null, waLid: LID });
    expect(c?.id).toBe(id);
  });

  itEnTenant('enlaza el LID a un cliente que ya existía por teléfono', async () => {
    // María García viene del seed, con teléfono y sin LID.
    const telefono = '+573101112233';
    const nuevoLid = '99999999999@lid';

    const { rows: antes } = await db.queryAdmin<{ id: string; wa_lid: string | null }>(
      `SELECT id, wa_lid FROM customers WHERE tenant_id = $1 AND phone = $2`, [tenantId, telefono],
    );
    expect(antes[0].wa_lid).toBeNull();

    const id = await buscarOCrearCliente(
      tenantId, { phone: telefono, waLid: nuevoLid }, 'María García',
    );

    // Se enlaza, no se duplica.
    expect(id).toBe(antes[0].id);
    const { rows: despues } = await db.queryAdmin<{ wa_lid: string }>(
      `SELECT wa_lid FROM customers WHERE id = $1`, [id],
    );
    expect(despues[0].wa_lid).toBe(nuevoLid);

    await db.queryAdmin(`UPDATE customers SET wa_lid = NULL WHERE id = $1`, [id]);
  });

  itEnTenant('sin ninguna identidad falla en vez de crear basura', async () => {
    await expect(
      buscarOCrearCliente(tenantId, { phone: null, waLid: null }, 'Nadie'),
    ).rejects.toThrow(/waLid/);
  });

  itEnTenant('la BD rechaza un cliente sin teléfono ni LID', async () => {
    await expect(
      db.queryAdmin(
        `INSERT INTO customers (tenant_id, first_name) VALUES ($1, 'Fantasma')`, [tenantId],
      ),
    ).rejects.toThrow(/chk_customers_identidad/);
  });
});
