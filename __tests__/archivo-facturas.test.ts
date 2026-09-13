/**
 * La copia propia de las facturas.
 *
 * RNF-LEG-3: la DIAN obliga a conservarlas cinco años, y hasta ahora sólo se
 * guardaba el número, el CUFE y una **URL** al PDF de Alegra. Eso no es
 * conservar: si esa cuenta se vence o el proveedor pierde el archivo, el
 * lavadero se queda sin los documentos que la ley le exige tener.
 *
 * Lo que más importa probar no es que guarde —eso es un INSERT— sino:
 *
 * 1. Que **verifique** lo que devuelve. Una copia que no se puede comprobar no
 *    es una copia, y entregar como auténtico un documento corrupto es peor que
 *    decir que se perdió.
 * 2. Que **no pueda romper una emisión**. Una factura emitida con la copia
 *    pendiente es un problema mucho menor que una emisión que falla por no poder
 *    guardarla.
 * 3. Que **no se archive basura**: un HTML de error descargado desde una URL
 *    vencida daría por resuelto algo que no sirve, y nadie vuelve a mirar.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';
import {
  guardarArtefacto,
  leerArtefacto,
  archivarFactura,
  verificarIntegridad,
} from '../src/modules/billing/archivo';
import { conTenant } from './helpers/rls';

/** Un PDF mínimo pero real: empieza con %PDF, que es lo que se valida. */
const PDF = Buffer.from('%PDF-1.4\n' + 'x'.repeat(200) + '\n%%EOF');

let tenantId = '';
let paymentId = '';
let appointmentId = '';
let token = '';

const datos = () => ({
  tenantId,
  paymentId,
  invoiceId: 'ALEGRA-123',
  invoiceNumber: 'FE-001',
  cufe: 'cufe-de-prueba',
  issuedAt: '2026-09-01',
});

beforeAll(async () => {
  const { rows: t } = await db.queryAdmin<{ id: string }>(
    `SELECT id FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenantId = t[0].id;

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@elbrillante.co', password: 'admin123' });
  token = login.body.accessToken;
  expect(token).toBeTruthy();

  // Turno y pago propios: estas pruebas escriben, y el archivo cuelga de un pago
  // real por la clave foránea. El seed no crea turnos —eso es `db:demo`— así que
  // se arma uno acá en vez de depender de que exista.
  const { rows: base } = await db.queryAdmin<{ c: string; v: string; s: string }>(
    `SELECT (SELECT id FROM customers WHERE tenant_id = $1 LIMIT 1) AS c,
            (SELECT id FROM vehicles  WHERE tenant_id = $1 LIMIT 1) AS v,
            (SELECT id FROM services  WHERE tenant_id = $1 LIMIT 1) AS s`,
    [tenantId],
  );
  const { rows: a } = await db.queryAdmin<{ id: string }>(
    `INSERT INTO appointments
       (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, price, status)
     VALUES ($1, $2, $3, $4, CURRENT_DATE, 2500000, 'done') RETURNING id`,
    [tenantId, base[0].c, base[0].v, base[0].s],
  );
  appointmentId = a[0].id;

  const { rows: p } = await db.queryAdmin<{ id: string }>(
    `INSERT INTO payments (tenant_id, appointment_id, amount, payment_method)
     VALUES ($1, $2, 2500000, 'cash') RETURNING id`,
    [tenantId, appointmentId],
  );
  paymentId = p[0].id;
});

beforeEach(async () => {
  await db.queryAdmin(`DELETE FROM invoice_archive WHERE payment_id = $1`, [paymentId]);
});

afterAll(async () => {
  await db.queryAdmin(`DELETE FROM invoice_archive WHERE payment_id = $1`, [paymentId]);
  await db.queryAdmin(`DELETE FROM payments WHERE id = $1`, [paymentId]);
  await db.queryAdmin(`DELETE FROM appointments WHERE id = $1`, [appointmentId]);
  await db.pool.end();
});

describe('guardar y recuperar', () => {
  it('guarda el documento y lo devuelve byte por byte', async () => {
    await conTenant(tenantId, async () => {
      await guardarArtefacto(datos(), 'pdf', PDF, 'application/pdf');
      const leido = await leerArtefacto(tenantId, paymentId, 'pdf');

      expect(leido).not.toBeNull();
      expect(leido!.bytes).toBe(PDF.length);
      // No "parecido": idéntico. Una factura con un byte distinto es otra.
      expect(Buffer.compare(leido!.content, PDF)).toBe(0);
    });
  });

  it('reintentar el archivado reemplaza, no duplica ni falla', async () => {
    await conTenant(tenantId, async () => {
      await guardarArtefacto(datos(), 'pdf', PDF, 'application/pdf');
      const corregido = Buffer.from('%PDF-1.4\nversion corregida\n%%EOF');
      await guardarArtefacto(datos(), 'pdf', corregido, 'application/pdf');

      const leido = await leerArtefacto(tenantId, paymentId, 'pdf');
      expect(Buffer.compare(leido!.content, corregido)).toBe(0);
    });

    const { rows } = await db.queryAdmin<{ n: string }>(
      `SELECT count(*)::text AS n FROM invoice_archive WHERE payment_id = $1 AND kind = 'pdf'`,
      [paymentId],
    );
    expect(rows[0].n).toBe('1');
  });

  it('un documento vacío se rechaza en vez de dar por archivado nada', async () => {
    await conTenant(tenantId, async () => {
      await expect(
        guardarArtefacto(datos(), 'pdf', Buffer.alloc(0), 'application/pdf'),
      ).rejects.toThrow(/vac/i);
    });
  });
});

describe('lo que hace que sea una copia y no un archivo cualquiera', () => {
  it('si el contenido no coincide con su hash, no se entrega', async () => {
    // El caso que justifica guardar el hash: corrupción silenciosa en un
    // respaldo de hace tres años, descubierta el día que la DIAN pide el
    // documento. Entregarlo como auténtico sería peor que decir que se perdió.
    await conTenant(tenantId, async () => {
      await guardarArtefacto(datos(), 'pdf', PDF, 'application/pdf');
    });

    await db.queryAdmin(
      `UPDATE invoice_archive SET content = $1 WHERE payment_id = $2 AND kind = 'pdf'`,
      [Buffer.from('%PDF-1.4\nESTO NO ES LO QUE SE ARCHIVO\n') as unknown as string, paymentId],
    );

    await conTenant(tenantId, async () => {
      await expect(leerArtefacto(tenantId, paymentId, 'pdf')).rejects.toThrow(/corrupt/i);
    });
  });

  it('verificarIntegridad encuentra el corrupto entre los sanos', async () => {
    await conTenant(tenantId, async () => {
      await guardarArtefacto(datos(), 'pdf', PDF, 'application/pdf');
      await guardarArtefacto(datos(), 'json', Buffer.from('{"ok":true}'), 'application/json');
    });

    // Dentro del contexto: `verificarIntegridad` consulta como cualquier otra
    // cosa, y con RLS activo sin contexto no ve ninguna fila. En producción la
    // corre `db:verificar-facturas`, que pide el bypass porque recorre todos los
    // lavaderos.
    let estado = await conTenant(tenantId, () => verificarIntegridad(tenantId));
    expect(estado.total).toBe(2);
    expect(estado.corruptos).toHaveLength(0);

    await db.queryAdmin(
      `UPDATE invoice_archive SET content = $1 WHERE payment_id = $2 AND kind = 'json'`,
      [Buffer.from('{"alterado":true}') as unknown as string, paymentId],
    );

    estado = await conTenant(tenantId, () => verificarIntegridad(tenantId));
    expect(estado.total).toBe(2);
    expect(estado.corruptos).toHaveLength(1);
    expect(estado.corruptos[0].kind).toBe('json');
  });
});

describe('archivar al emitir no puede romper la emisión', () => {
  it('si el PDF no se puede bajar, igual guarda el JSON y no lanza', async () => {
    const res = await conTenant(tenantId, () =>
      archivarFactura(datos(), { id: 'ALEGRA-123', total: 25000 }, 'http://127.0.0.1:1/no-existe'),
    );

    // Lo esencial: no lanzó. La factura ya está emitida.
    expect(res.json).toBe(true);
    expect(res.pdf).toBe(false);

    await conTenant(tenantId, async () => {
      const json = await leerArtefacto(tenantId, paymentId, 'json');
      expect(json).not.toBeNull();
      expect(JSON.parse(json!.content.toString())).toMatchObject({ id: 'ALEGRA-123' });
    });
  });

  it('no archiva lo que no es un PDF, aunque la descarga responda 200', async () => {
    // Una URL vencida suele devolver un HTML de login con 200. Guardarlo daría
    // por archivada una factura que no existe, y nadie vuelve a mirar.
    const espia = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('<html><body>Inicia sesión</body></html>', { status: 200 }),
      );

    try {
      const res = await conTenant(tenantId, () =>
        archivarFactura(datos(), { id: 'ALEGRA-123' }, 'https://alegra.example/factura.pdf'),
      );
      expect(res.pdf).toBe(false);

      await conTenant(tenantId, async () => {
        expect(await leerArtefacto(tenantId, paymentId, 'pdf')).toBeNull();
      });
    } finally {
      espia.mockRestore();
    }
  });

  it('con un PDF de verdad sí lo archiva', async () => {
    const espia = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(PDF, { status: 200 }));

    try {
      const res = await conTenant(tenantId, () =>
        archivarFactura(datos(), { id: 'ALEGRA-123' }, 'https://alegra.example/factura.pdf'),
      );
      expect(res.pdf).toBe(true);

      await conTenant(tenantId, async () => {
        const pdf = await leerArtefacto(tenantId, paymentId, 'pdf');
        expect(Buffer.compare(pdf!.content, PDF)).toBe(0);
      });
    } finally {
      espia.mockRestore();
    }
  });
});

describe('descargar la copia desde el panel', () => {
  it('devuelve el PDF con su hash en una cabecera', async () => {
    await conTenant(tenantId, async () => {
      await guardarArtefacto(datos(), 'pdf', PDF, 'application/pdf');
    });

    const res = await request(app)
      .get(`/api/billing/archivo/${paymentId}/pdf`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('FE-001');
    // Para que quien descarga pueda verificar por su cuenta.
    expect(res.headers['x-documento-sha256']).toHaveLength(64);
    expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
  });

  it('sin copia archivada dice cómo recuperarla, en vez de un 404 pelado', async () => {
    const res = await request(app)
      .get(`/api/billing/archivo/${paymentId}/pdf`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('db:archivar-facturas');
  });

  it('un tipo inventado da 400', async () => {
    const res = await request(app)
      .get(`/api/billing/archivo/${paymentId}/docx`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('el aislamiento entre lavaderos alcanza a las facturas', () => {
  it('toda tabla con tenant_id tiene política de RLS', async () => {
    // La lista de tablas de `migrate-rls` era fija, así que agregar
    // `invoice_archive` la habría dejado sin política y sin que nada avisara —
    // un agujero creado por omisión. Ahora se descubren, y esto lo verifica para
    // las que vengan después.
    const { rows } = await db.queryAdmin<{ table_name: string }>(
      `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
         AND t.table_type = 'BASE TABLE'
         AND NOT EXISTS (
           SELECT 1 FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = c.table_name
         )`,
    );

    expect(rows.map((r) => r.table_name)).toEqual([]);
  });
});
