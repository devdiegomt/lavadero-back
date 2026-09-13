/**
 * El contexto de tenant de la petición en curso.
 *
 * RLS necesita que la conexión sepa de qué tenant se trata: las políticas leen
 * `current_setting('app.tenant_id')`. El problema es que las conexiones salen de
 * un **pool**, así que no alcanza con fijarlo una vez — cada petición usa la
 * conexión que le toque.
 *
 * La salida es `AsyncLocalStorage`: se toma una conexión al empezar la petición,
 * se le fija el tenant, y queda guardada en el contexto asíncrono. `db.query()`
 * la usa sin que nadie se lo pida.
 *
 * **Por eso no hubo que tocar las 212 consultas del proyecto.** La alternativa
 * era pasar un cliente por parámetro a cada función que consulta, y eso sí es una
 * refactorización de todo — con la garantía de que alguna quedaría afuera.
 *
 * ## El costo, que es real
 *
 * Cada petición retiene una conexión del pool mientras dura, en vez de tomarla y
 * devolverla por consulta. Con `max: 10` eso son diez peticiones concurrentes
 * antes de que la undécima espere. Para un lavadero sobra; si esto creciera a
 * muchos tenants activos a la vez, el pool es lo primero a subir.
 *
 * ## Fuera de una petición
 *
 * Los scripts de migración, los seeds y los crons no tienen contexto. `db.query()`
 * cae al pool como siempre, y ahí RLS **sí** bloquea si el rol no es superusuario.
 * Por eso las tareas de fondo que tocan varios tenants —recordatorios, retención—
 * corren con la puerta de atrás explícita (`conBypassRls`), que es lo que hace
 * visible que cruzan tenants a propósito.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';

interface Contexto {
  cliente: PoolClient;
  /** El tenant fijado en esa conexión. Para diagnóstico. */
  tenantId: string | null;
  /** Si la conexión tiene la puerta de atrás abierta. Para diagnóstico. */
  bypass: boolean;
}

const almacen = new AsyncLocalStorage<Contexto>();

/** La conexión de la petición en curso, si hay una. */
export function clienteDelContexto(): PoolClient | null {
  return almacen.getStore()?.cliente ?? null;
}

/** Para diagnóstico y para las pruebas. */
export function contextoActual(): { tenantId: string | null; bypass: boolean } | null {
  const ctx = almacen.getStore();
  return ctx ? { tenantId: ctx.tenantId, bypass: ctx.bypass } : null;
}

/** Corre `fn` con esa conexión como la del contexto. */
export function correrEnContexto<T>(ctx: Contexto, fn: () => Promise<T>): Promise<T> {
  return almacen.run(ctx, fn);
}

export type { Contexto };
