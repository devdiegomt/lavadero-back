/**
 * Que no quede ningún objeto con datos de varios lavaderos que RLS no pueda
 * vigilar.
 *
 * Esto sale de un caso concreto. `mv_daily_summary` era una *materialized view*
 * con los ingresos y el volumen diario de **todos** los tenants, y PostgreSQL
 * **no admite políticas de RLS sobre una materialized view**. Comprobado contra
 * la base: sin contexto de tenant, `appointments` devolvía 0 filas y la vista las
 * devolvía todas.
 *
 * No era una fuga, porque nadie la leía. Era algo peor de tener: un objeto
 * cargado con datos de todos, que el motor no puede proteger, esperando a que
 * alguien lo conectara a una pantalla. Se borró.
 *
 * La guarda mira dos cosas distintas:
 *
 * - Que no haya **vistas materializadas** con `tenant_id`. Sobre esas RLS no se
 *   puede aplicar ni aunque alguien se acuerde.
 * - Que no haya **tablas** con `tenant_id` sin política. Ésas sí se pueden
 *   proteger, y el riesgo es olvidarse: `db:migrate-rls` descubre las tablas del
 *   catálogo justamente para que agregar una nueva no las deje afuera, pero eso
 *   sólo sirve si alguien vuelve a correrlo.
 */
import * as db from '../src/shared/db';

afterAll(async () => {
  await db.pool.end();
});

describe('objetos con datos de varios lavaderos', () => {
  it('ninguna vista materializada lleva tenant_id', async () => {
    const { rows } = await db.queryAdmin<{ nombre: string }>(
      `SELECT c.relname AS nombre
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid
       WHERE n.nspname = 'public'
         AND c.relkind = 'm'
         AND a.attname = 'tenant_id'
         AND a.attnum > 0
       ORDER BY c.relname`,
    );

    // Si esto falla: RLS no se puede aplicar a una vista materializada. Cuando
    // haga falta precalcular, va una tabla normal con su política, llenada por
    // una tarea con bypass.
    expect(rows.map((r) => r.nombre)).toEqual([]);
  });

  it('toda tabla con tenant_id tiene RLS y su política', async () => {
    const { rows } = await db.queryAdmin<{ nombre: string; rls: boolean; politicas: number }>(
      `SELECT c.relname AS nombre,
              c.relrowsecurity AS rls,
              (SELECT count(*)::int FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS politicas
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND a.attname = 'tenant_id'
         AND a.attnum > 0
       ORDER BY c.relname`,
    );

    expect(rows.length).toBeGreaterThan(0); // si no, la consulta está mal, no el esquema

    // Si esto falla, son tablas con `tenant_id` sin RLS o sin política: correr
    // `npm run db:migrate-rls`, que las descubre del catálogo.
    const desprotegidas = rows.filter((t) => !t.rls || t.politicas === 0);
    expect(desprotegidas.map((t) => t.nombre)).toEqual([]);
  });
});
