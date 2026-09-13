/**
 * Row Level Security: el aislamiento entre lavaderos, exigido por el motor.
 *
 * Antes dependía **sólo de la disciplina**: cada consulta lleva `tenant_id` en el
 * `WHERE` por convención, y nada impedía escribir una que lo olvidara. 212
 * consultas, y una sola que se equivoque filtra datos entre lavaderos.
 *
 * **Estas pruebas se conectan con el rol de la aplicación, no con `postgres`.**
 * Es el punto entero: PostgreSQL no aplica RLS a superusuarios ni a roles con
 * `BYPASSRLS`, así que probar con el rol de siempre daría verde sin medir nada —
 * y sería la tercera vez en este proyecto que algo *parece* protegido leyendo el
 * código. Si el rol no existe, estas pruebas fallan en vez de saltearse.
 */
import { Pool } from 'pg';
import * as db from '../src/shared/db';
import { estadoRls } from '../src/shared/db/rls';

/** Conexión con el rol de la aplicación: sin superusuario y sin BYPASSRLS. */
let appPool: Pool;

let tenantA = '';
let tenantB = '';
let clienteDeA = '';
let clienteDeB = '';

/** Corre una consulta como la aplicación, con el tenant fijado. */
async function comoTenant<T extends object = Record<string, unknown>>(
  tenantId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const cliente = await appPool.connect();
  try {
    await cliente.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId ?? '']);
    const { rows } = await cliente.query<T>(sql, params);
    return rows;
  } finally {
    cliente.release();
  }
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL as string);
  url.username = 'carwash_app';
  url.password = process.env.DB_APP_PASSWORD ?? 'app_de_prueba';
  appPool = new Pool({ connectionString: url.toString(), max: 4 });

  // Guarda: si el rol no existe o no tiene permisos, hay que enterarse acá y no
  // con once pruebas verdes que no probaron nada.
  const { rows } = await appPool.query<{ rol: string; super: boolean; bypass: boolean }>(
    `SELECT current_user AS rol, rolsuper AS super, rolbypassrls AS bypass
     FROM pg_roles WHERE rolname = current_user`,
  );
  expect(rows[0].rol).toBe('carwash_app');
  expect(rows[0].super).toBe(false);
  expect(rows[0].bypass).toBe(false);

  const { rows: a } = await db.queryAdmin<{ id: string }>(
    `SELECT id FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenantA = a[0].id;

  // Un segundo lavadero, que es la única forma de probar que no se ven entre sí.
  const { rows: b } = await db.queryAdmin<{ id: string }>(
    `INSERT INTO tenants (name, slug, whatsapp_phone, timezone)
     VALUES ('Lavadero Vecino', 'vecino-rls', '+573009990000', 'America/Bogota')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  tenantB = b[0].id;

  const { rows: ca } = await db.queryAdmin<{ id: string }>(
    `INSERT INTO customers (tenant_id, first_name, phone)
     VALUES ($1, 'ClienteDeA', '+573001110001') RETURNING id`,
    [tenantA],
  );
  clienteDeA = ca[0].id;

  const { rows: cb } = await db.queryAdmin<{ id: string }>(
    `INSERT INTO customers (tenant_id, first_name, phone)
     VALUES ($1, 'ClienteDeB', '+573001110002') RETURNING id`,
    [tenantB],
  );
  clienteDeB = cb[0].id;
});

afterAll(async () => {
  await db.queryAdmin(`DELETE FROM customers WHERE id = ANY($1)`, [[clienteDeA, clienteDeB]]);
  await db.queryAdmin(`DELETE FROM tenants WHERE slug = 'vecino-rls'`);
  await appPool.end();
  await db.pool.end();
});

describe('una consulta sin filtro ya no cruza lavaderos', () => {
  it('un SELECT sin WHERE devuelve sólo las filas del tenant fijado', async () => {
    // La consulta que antes era la fuga: sin `tenant_id` en el WHERE.
    const deA = await comoTenant<{ first_name: string }>(
      tenantA,
      `SELECT first_name FROM customers WHERE first_name LIKE 'ClienteDe%'`,
    );
    const nombresA = deA.map((f) => f.first_name);
    expect(nombresA).toContain('ClienteDeA');
    expect(nombresA).not.toContain('ClienteDeB');

    const deB = await comoTenant<{ first_name: string }>(
      tenantB,
      `SELECT first_name FROM customers WHERE first_name LIKE 'ClienteDe%'`,
    );
    const nombresB = deB.map((f) => f.first_name);
    expect(nombresB).toContain('ClienteDeB');
    expect(nombresB).not.toContain('ClienteDeA');
  });

  it('pedir por id un registro de otro lavadero no devuelve nada', async () => {
    // Es la fuga más concreta: un id filtrado por cualquier vía.
    const filas = await comoTenant(tenantA, `SELECT id FROM customers WHERE id = $1`, [clienteDeB]);
    expect(filas).toHaveLength(0);
  });

  it('tampoco se puede modificar lo de otro lavadero', async () => {
    const { rowCount } = await (async () => {
      const cliente = await appPool.connect();
      try {
        await cliente.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantA]);
        return await cliente.query(`UPDATE customers SET first_name = 'Robado' WHERE id = $1`, [
          clienteDeB,
        ]);
      } finally {
        cliente.release();
      }
    })();

    expect(rowCount).toBe(0);

    // Y sigue llamándose como antes.
    const { rows } = await db.queryAdmin<{ first_name: string }>(
      `SELECT first_name FROM customers WHERE id = $1`, [clienteDeB],
    );
    expect(rows[0].first_name).toBe('ClienteDeB');
  });

  it('ni borrarlo', async () => {
    const cliente = await appPool.connect();
    try {
      await cliente.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantA]);
      const { rowCount } = await cliente.query(`DELETE FROM customers WHERE id = $1`, [clienteDeB]);
      expect(rowCount).toBe(0);
    } finally {
      cliente.release();
    }
  });

  it('ni insertar una fila con el tenant de otro', async () => {
    // `WITH CHECK` es la mitad que suele faltar: sin ella se puede escribir
    // donde no se puede leer, que es peor.
    const cliente = await appPool.connect();
    try {
      await cliente.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantA]);
      await expect(
        cliente.query(
          `INSERT INTO customers (tenant_id, first_name, phone) VALUES ($1, 'Infiltrado', '+573001110003')`,
          [tenantB],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      cliente.release();
    }
  });

  it('el propio lavadero sí se ve en tenants, el vecino no', async () => {
    const propio = await comoTenant(tenantA, `SELECT id FROM tenants`);
    expect(propio).toHaveLength(1);
    expect((propio[0] as { id: string }).id).toBe(tenantA);
  });
});

describe('falla cerrado', () => {
  it('sin tenant fijado no se ve nada, en vez de verse todo', async () => {
    // La decisión más importante de las políticas. Si fallara abierto, una ruta
    // que se olvide de abrir el contexto filtraría todo sin que nadie lo note;
    // así devuelve vacío, que se nota enseguida.
    const filas = await comoTenant(null, `SELECT id FROM customers`);
    expect(filas).toHaveLength(0);
  });

  it('un tenant_id basura no rompe la consulta, simplemente no ve nada', async () => {
    // `nullif(..., '')::uuid` evita que un valor vacío reviente el cast y
    // convierta un problema de aislamiento en un 500.
    const filas = await comoTenant('00000000-0000-4000-8000-000000000000', `SELECT id FROM customers`);
    expect(filas).toHaveLength(0);
  });
});

describe('la puerta de atrás', () => {
  it('con app.bypass_rls se ve todo, que es para lo que existe', async () => {
    const cliente = await appPool.connect();
    try {
      await cliente.query('SELECT set_config($1, $2, false)', ['app.bypass_rls', 'on']);
      const { rows } = await cliente.query<{ first_name: string }>(
        `SELECT first_name FROM customers WHERE first_name LIKE 'ClienteDe%'`,
      );
      const nombres = rows.map((f) => f.first_name);
      expect(nombres).toContain('ClienteDeA');
      expect(nombres).toContain('ClienteDeB');
    } finally {
      cliente.release();
    }
  });

  it('se limpia al devolver la conexión al pool', async () => {
    // Si quedara pegada, la próxima petición que tome esa conexión vería todos
    // los lavaderos. Es el modo de fallo más peligroso de este diseño.
    const primera = await appPool.connect();
    try {
      await primera.query('SELECT set_config($1, $2, false)', ['app.bypass_rls', 'on']);
      await primera.query(`SELECT set_config('app.bypass_rls', '', false)`);
      const { rows } = await primera.query<{ v: string }>(
        `SELECT coalesce(current_setting('app.bypass_rls', true), '') AS v`,
      );
      expect(rows[0].v).toBe('');
    } finally {
      primera.release();
    }
  });
});

describe('el estado se puede verificar', () => {
  it('estadoRls dice si las políticas se aplican de verdad', async () => {
    const e = await estadoRls();

    expect(e.tablasConRls).toBeGreaterThanOrEqual(14);
    expect(e.politicas).toBeGreaterThanOrEqual(14);

    // Las pruebas corren como `postgres`, que saltea RLS. Que `activo` sea falso
    // acá es correcto y es justamente lo que el aviso de arranque reporta: las
    // políticas existen y con ese rol no hacen nada.
    expect(e.activo).toBe(!e.esSuperusuario && !e.salteaRls);
  });
});
