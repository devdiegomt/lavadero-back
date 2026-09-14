/**
 * Pool de conexiones PostgreSQL con query tipado.
 *
 * Usa process.env directamente (no config) para que los scripts de
 * migración y seed puedan importar este módulo standalone sin que
 * config.ts exija ENCRYPTION_KEY y otras vars del servidor web.
 *
 * Uso tipado en controllers:
 *   const { rows } = await db.query<AppointmentRow>(
 *     'SELECT * FROM appointments WHERE id = $1', [id]
 *   );
 *   // rows: AppointmentRow[]
 */

import { Pool, type PoolClient, type QueryResult } from 'pg';
import { clienteDelContexto } from './contexto';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway/Render/Fly usan SSL en producción
  ssl:
    process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Log de conexión (solo en dev)
pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('📦 Conectado a PostgreSQL');
  }
});

pool.on('error', (err: Error) => {
  console.error('❌ Error inesperado en PostgreSQL:', err.message);
});

/**
 * Avisar cuando el pool se está quedando sin conexiones, **antes** de que
 * empiece a devolver 500.
 *
 * Esto existe por un diagnóstico que costó cuatro hipótesis. El CI fallaba, y lo
 * único que había para mirar era `pg_stat_activity` desde afuera, que decía
 * `idle = 10`. Eso parece un pool sano y era lo contrario: **`idle` significa
 * que el servidor no está ejecutando nada en esa conexión, no que esté libre en
 * el pool.** Las diez estaban tomadas por la aplicación y sin devolver.
 *
 * El pool sí sabe la diferencia, y no la estaba contando nadie:
 *
 * - `totalCount` — conexiones abiertas.
 * - `idleCount`  — de ésas, cuántas están **libres en el pool**. Esto es lo que
 *   `pg_stat_activity` no puede responder.
 * - `waitingCount` — peticiones esperando una conexión. Si esto es mayor que
 *   cero, ya hay alguien encolado y el 500 viene en camino.
 *
 * Sólo avisa cuando hay cola, y como mucho una vez por minuto: un log que
 * aparece siempre no lo lee nadie.
 */
const MS_ENTRE_AVISOS = 60_000;
let ultimoAviso = 0;

setInterval(() => {
  if (pool.waitingCount === 0) return;

  const ahora = Date.now();
  if (ahora - ultimoAviso < MS_ENTRE_AVISOS) return;
  ultimoAviso = ahora;

  console.warn(
    '⚠️  Pool de PostgreSQL con cola: ' +
      `abiertas=${pool.totalCount} libres=${pool.idleCount} esperando=${pool.waitingCount}. ` +
      'Si `libres` es 0 y `esperando` no baja, hay conexiones tomadas que no se devuelven.',
  );
  // `unref` para que este intervalo no mantenga vivo el proceso: sin esto, los
  // scripts que terminan (migraciones, seeds) se quedarían colgados.
}, 5_000).unref();

/**
 * Parámetro de una consulta.
 *
 * Los arrays están incluidos porque hay columnas de tipo array
 * (`action_log.fields`, `tenants.closed_weekdays`) y `node-pg` las maneja
 * nativamente. Sin esto, escribir en una obligaba a castear en el punto de
 * llamada, que es justo donde el cast deja de verse.
 */
export type ParametroSql =
  | string
  | number
  | boolean
  | null
  | Date
  | undefined
  | string[]
  | number[];

/**
 * Ejecuta una query con parámetros opcionales.
 *
 * Genérico: T define el shape de cada fila devuelta.
 * Si no se especifica, devuelve `Record<string, unknown>`.
 *
 * Ejemplo:
 *   const { rows } = await db.query<UserRow>(
 *     'SELECT * FROM users WHERE tenant_id = $1 AND is_active = true',
 *     [tenantId]
 *   );
 */
export async function query<T extends object = Record<string, unknown>>(
  text: string,
  params?: ParametroSql[],
): Promise<QueryResult<T>> {
  // Si hay una petición en curso con contexto de tenant, la consulta va por esa
  // conexión: es la que tiene `app.tenant_id` fijado, y sin eso RLS no devuelve
  // nada. Ver shared/db/contexto.ts.
  const delContexto = clienteDelContexto();
  if (delContexto) return delContexto.query<T>(text, params as unknown[]);

  return pool.query<T>(text, params as unknown[]);
}

/**
 * Consulta que **saltea RLS**, para trabajo de administración de la base.
 *
 * Es para los seeds, los scripts y los fixtures de las pruebas: cosas que por
 * naturaleza cruzan tenants o preparan datos antes de que exista una petición.
 * Con RLS activo, `query()` sin contexto no ve nada —falla cerrado a propósito—
 * así que ese trabajo necesita decir explícitamente que lo está salteando.
 *
 * **No usar desde un controller.** Si hace falta cruzar tenants en una ruta, el
 * lugar correcto es `conBypassRls` en el router, donde queda a la vista y
 * enumerado junto a las otras dos excepciones. La diferencia entre esto y no
 * tener RLS es que el agujero sea visible y contable.
 */
export async function queryAdmin<T extends object = Record<string, unknown>>(
  text: string,
  params?: ParametroSql[],
): Promise<QueryResult<T>> {
  const cliente = await pool.connect();
  try {
    await cliente.query(`SELECT set_config('app.bypass_rls', 'on', false)`);
    return await cliente.query<T>(text, params as unknown[]);
  } finally {
    // Se limpia antes de devolverla al pool: si quedara pegada, la próxima
    // petición que tome esta conexión vería todos los lavaderos. Es el modo de
    // fallo más peligroso de este diseño.
    await cliente.query(`SELECT set_config('app.bypass_rls', '', false)`).catch(() => undefined);
    cliente.release();
  }
}

/**
 * Obtiene un cliente del pool para transacciones manuales.
 *
 * Siempre liberar el cliente en el bloque `finally`:
 *   const client = await db.getClient();
 *   try {
 *     await client.query('BEGIN');
 *     await client.query('INSERT INTO ...');
 *     await client.query('COMMIT');
 *   } catch (err) {
 *     await client.query('ROLLBACK');
 *     throw err;
 *   } finally {
 *     client.release();
 *   }
 *
 * **Dentro de una petición devuelve la conexión del contexto**, que es la que
 * tiene el tenant fijado. Tomar otra del pool dejaría la transacción sin
 * `app.tenant_id` y RLS no le mostraría nada — un `INSERT ... RETURNING` que no
 * devuelve nada, sin error que explique por qué.
 *
 * Por eso `release()` en esa conexión es deliberadamente inofensivo: la libera
 * quien abrió el contexto, al terminar la petición. Los cinco sitios que usan
 * transacciones no tuvieron que cambiar.
 */
export async function getClient(): Promise<PoolClient> {
  const delContexto = clienteDelContexto();
  if (delContexto) {
    // `release` se neutraliza: si el controller la liberara a mitad de la
    // petición, las consultas siguientes irían a otra conexión sin tenant.
    return new Proxy(delContexto, {
      get(destino, prop, receptor) {
        if (prop === 'release') return () => undefined;
        return Reflect.get(destino, prop, receptor) as unknown;
      },
    });
  }
  return pool.connect();
}

/** Pool crudo — usar solo cuando query/getClient no sean suficientes. */
export { pool };