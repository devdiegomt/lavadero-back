/**
 * Que las tareas de fondo sigan haciendo algo cuando RLS se aplica de verdad.
 *
 * `npm run test:rls` corre toda la suite con `DATABASE_URL` apuntando a
 * `carwash_app`, el rol al que sí se le aplican las políticas. Pero la suite
 * entra siempre **por HTTP**, y ahí el contexto de tenant lo abre
 * `requireTenant`. Los crons no pasan por ahí: corren fuera de una petición, sin
 * contexto, y eso no lo cubría nada.
 *
 * Lo que aparece cuando se mira es peor que un error. Un `DELETE` que no
 * coincide con ninguna fila por la política **no falla**: borra cero y no dice
 * nada. Comprobado contra la base antes de arreglarlo — la fila candidata seguía
 * ahí después de correr la limpieza.
 *
 * Estas pruebas pasan con los dos roles. Con `postgres` porque las políticas no
 * lo alcanzan; con `carwash_app` sólo si el bypass está donde tiene que estar.
 * O sea que la que vale es la corrida de `npm run test:rls`.
 */
import * as db from '../src/shared/db';
import { cleanOldBillingErrors } from '../src/shared/db/cron';
import { conBypassRlsFueraDePeticion } from '../src/shared/middleware/rls';
import { estadoRls } from '../src/shared/db/rls';

const MARCA = 'prueba de limpieza bajo rls';

async function tenantCualquiera(): Promise<string> {
  const { rows } = await db.queryAdmin<{ id: string }>('SELECT id FROM tenants LIMIT 1');
  if (rows.length === 0) throw new Error('No hay tenants: ¿falta npm run db:seed?');
  return rows[0].id;
}

async function cuantasQuedan(): Promise<number> {
  const { rows } = await db.queryAdmin<{ n: string }>(
    'SELECT count(*)::text AS n FROM billing_errors WHERE error_message = $1',
    [MARCA],
  );
  return Number(rows[0].n);
}

afterAll(async () => {
  await db.queryAdmin('DELETE FROM billing_errors WHERE error_message = $1', [MARCA]);
  await db.pool.end();
});

describe('la limpieza de billing_errors', () => {
  beforeEach(async () => {
    await db.queryAdmin('DELETE FROM billing_errors WHERE error_message = $1', [MARCA]);
    await db.queryAdmin(
      `INSERT INTO billing_errors (tenant_id, payment_id, error_message, resolved_at, created_at)
       VALUES ($1, NULL, $2, NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days')`,
      [await tenantCualquiera(), MARCA],
    );
  });

  it('borra de verdad las filas viejas, no cero de ellas', async () => {
    expect(await cuantasQuedan()).toBe(1);

    // Tal como la programa `initCronJobs`.
    await conBypassRlsFueraDePeticion(() => cleanOldBillingErrors());

    expect(await cuantasQuedan()).toBe(0);
  });

  it('sin el bypass no borra nada, y no lo dice', async () => {
    // Deja constancia del modo de fallo, que es lo que hace falta la prueba de
    // arriba: **no lanza ningún error**. Simplemente borra cero.
    //
    // Lo que pasa depende del rol, así que se pregunta en vez de suponer: con
    // `postgres` las políticas no lo alcanzan y sí borra; con `carwash_app` la
    // fila sobrevive. Afirmar las dos cosas hace que esta prueba signifique algo
    // en las dos corridas, en vez de conformarse con "no revienta".
    const { activo } = await estadoRls();

    await expect(cleanOldBillingErrors()).resolves.toBeUndefined();

    expect(await cuantasQuedan()).toBe(activo ? 1 : 0);
  });
});
