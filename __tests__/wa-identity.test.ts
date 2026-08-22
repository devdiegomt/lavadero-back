/**
 * Identificación de clientes por LID de WhatsApp.
 *
 * WhatsApp multi-device no entrega el teléfono: la key del mensaje trae sólo
 * el @lid y contacts.upsert nunca dispara. Comprobado en producción con
 * camposKey = { remoteJid, fromMe, id }. El LID pasa a ser el identificador.
 */
import * as db from '../src/shared/db';
import {
  leerIdentidad,
  tieneIdentidad,
  claveSesion,
  buscarCliente,
  buscarOCrearCliente,
} from '../src/modules/whatsapp/wa-identity';

const LID = '16733343588585@lid';
let tenantId: string;

beforeAll(async () => {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenantId = rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM customers WHERE wa_lid LIKE '%@lid' AND tenant_id = $1`, [tenantId]);
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
  it('crea un cliente sólo con LID, sin teléfono', async () => {
    const id = await buscarOCrearCliente(tenantId, { phone: null, waLid: LID }, 'Diego Mayorga');
    expect(id).toBeTruthy();

    const { rows } = await db.query<{ phone: string | null; wa_lid: string; first_name: string; last_name: string }>(
      `SELECT phone, wa_lid, first_name, last_name FROM customers WHERE id = $1`, [id],
    );
    expect(rows[0].phone).toBeNull();          // phone dejó de ser NOT NULL
    expect(rows[0].wa_lid).toBe(LID);
    expect(rows[0].first_name).toBe('Diego');
    expect(rows[0].last_name).toBe('Mayorga');
  });

  it('el mismo LID devuelve el mismo cliente, no uno nuevo', async () => {
    const a = await buscarOCrearCliente(tenantId, { phone: null, waLid: LID }, 'Diego');
    const b = await buscarOCrearCliente(tenantId, { phone: null, waLid: LID }, 'Otro Nombre');
    expect(b).toBe(a);
  });

  it('lo encuentra por LID', async () => {
    const id = await buscarOCrearCliente(tenantId, { phone: null, waLid: LID }, 'Diego');
    const c = await buscarCliente(tenantId, { phone: null, waLid: LID });
    expect(c?.id).toBe(id);
  });

  it('enlaza el LID a un cliente que ya existía por teléfono', async () => {
    // María García viene del seed, con teléfono y sin LID.
    const telefono = '+573101112233';
    const nuevoLid = '99999999999@lid';

    const { rows: antes } = await db.query<{ id: string; wa_lid: string | null }>(
      `SELECT id, wa_lid FROM customers WHERE tenant_id = $1 AND phone = $2`, [tenantId, telefono],
    );
    expect(antes[0].wa_lid).toBeNull();

    const id = await buscarOCrearCliente(
      tenantId, { phone: telefono, waLid: nuevoLid }, 'María García',
    );

    // Se enlaza, no se duplica.
    expect(id).toBe(antes[0].id);
    const { rows: despues } = await db.query<{ wa_lid: string }>(
      `SELECT wa_lid FROM customers WHERE id = $1`, [id],
    );
    expect(despues[0].wa_lid).toBe(nuevoLid);

    await db.query(`UPDATE customers SET wa_lid = NULL WHERE id = $1`, [id]);
  });

  it('sin ninguna identidad falla en vez de crear basura', async () => {
    await expect(
      buscarOCrearCliente(tenantId, { phone: null, waLid: null }, 'Nadie'),
    ).rejects.toThrow(/waLid/);
  });

  it('la BD rechaza un cliente sin teléfono ni LID', async () => {
    await expect(
      db.query(
        `INSERT INTO customers (tenant_id, first_name) VALUES ($1, 'Fantasma')`, [tenantId],
      ),
    ).rejects.toThrow(/chk_customers_identidad/);
  });
});
