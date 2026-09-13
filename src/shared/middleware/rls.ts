/**
 * Abre el contexto de tenant que usan las políticas de RLS.
 *
 * Toma una conexión del pool, le fija `app.tenant_id`, y la deja en el contexto
 * asíncrono para que `db.query()` la use durante toda la petición. Ver
 * `shared/db/contexto.ts` y `shared/db/migrate-rls.ts`.
 *
 * ## Falla cerrado
 *
 * Si no se abre el contexto, `current_setting('app.tenant_id')` es NULL, la
 * comparación de la política da NULL y **no se ve ninguna fila**. Una ruta que
 * quede sin este middleware devuelve vacío, lo que se nota enseguida. Al revés
 * —fallar abierto— el olvido no se notaría nunca, que es justo la fuga que se
 * viene a cerrar.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { pool } from '../db';
import { correrEnContexto } from '../db/contexto';
import logger from '../utils/logger';

/**
 * Abre el contexto con el tenant de `req.tenantId`.
 *
 * Va **después** de `requireTenant`, que es quien lo pone. Si no hay tenant
 * —super admin, o una ruta pública— sigue sin abrir nada: esas consultas van al
 * pool y las bloquea RLS salvo que pasen por `conBypassRls`.
 */
export async function abrirContextoDeTenant(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const tenantId = req.tenantId;
  if (!tenantId) return next();

  let cliente;
  try {
    cliente = await pool.connect();
  } catch (err) {
    // Sin conexión no hay nada que hacer, pero el error tiene que decir qué
    // pasó: "pool agotado" y "base caída" se arreglan distinto.
    logger.error({ err }, 'No se pudo tomar una conexión para el contexto de tenant');
    next(err);
    return;
  }

  try {
    // `set_config(..., false)` es a nivel de sesión, no de transacción: la
    // conexión se usa para varias consultas sueltas a lo largo de la petición,
    // y `SET LOCAL` sólo duraría hasta el final de la transacción actual.
    await cliente.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId]);
  } catch (err) {
    cliente.release();
    next(err);
    return;
  }

  // Liberar cuando la respuesta termine, pase lo que pase. Sin esto, una
  // excepción a mitad de camino deja la conexión tomada para siempre y el pool
  // se agota de a poco — un síntoma que aparece horas después y lejos.
  let liberada = false;
  const liberar = (): void => {
    if (liberada) return;
    liberada = true;
    // Se limpia antes de devolverla: la conexión vuelve al pool y la próxima
    // petición podría heredar este tenant si no se resetea.
    cliente
      .query(`SELECT set_config('app.tenant_id', '', false)`)
      .catch(() => undefined)
      .finally(() => cliente.release());
  };
  res.on('finish', liberar);
  res.on('close', liberar);

  correrEnContexto({ cliente, tenantId, bypass: false }, async () => {
    next();
  }).catch((err: unknown) => {
    liberar();
    next(err);
  });
}

/**
 * Abre el contexto con la puerta de atrás: las políticas no se aplican.
 *
 * **Es un agujero deliberado** y sólo va en los tres caminos que no pueden tener
 * tenant todavía:
 *
 * - **Autenticación.** El login busca al usuario por email para averiguar de qué
 *   lavadero es. No se puede filtrar por tenant para averiguar el tenant.
 * - **Onboarding.** Crea el tenant: no puede filtrar por algo que no existe.
 * - **Super admin.** Su trabajo es ver todos los lavaderos.
 *
 * La diferencia con no tener RLS es que el agujero está acá, en tres usos que se
 * leen en un minuto, en vez de repartido en 212 consultas donde cualquiera puede
 * olvidar un `WHERE`.
 */
export function conBypassRls(motivo: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let cliente;
    try {
      cliente = await pool.connect();
      await cliente.query('SELECT set_config($1, $2, false)', ['app.bypass_rls', 'on']);
    } catch (err) {
      cliente?.release();
      logger.error({ err, motivo }, 'No se pudo abrir el contexto con bypass de RLS');
      next(err);
      return;
    }

    let liberada = false;
    const liberar = (): void => {
      if (liberada) return;
      liberada = true;
      cliente
        .query(`SELECT set_config('app.bypass_rls', '', false)`)
        .catch(() => undefined)
        .finally(() => cliente.release());
    };
    res.on('finish', liberar);
    res.on('close', liberar);

    correrEnContexto({ cliente, tenantId: null, bypass: true }, async () => {
      next();
    }).catch((err: unknown) => {
      liberar();
      next(err);
    });
  };
}

/**
 * Lo mismo, fuera de una petición: para los crons y las tareas de fondo.
 *
 * Los recordatorios y la retención recorren **todos** los tenants a propósito, y
 * no tienen un `req.tenantId` del que partir. Que tengan que pedir el bypass de
 * forma explícita es el punto: hace visible en el código que cruzan tenants, en
 * vez de que funcione por casualidad.
 */
/**
 * Abre el contexto de un tenant fuera de una petición.
 *
 * Para llamar a código de la aplicación sin pasar por HTTP: una tarea de fondo
 * que trabaja sobre un lavadero concreto, o una prueba que ejercita una función
 * directamente. Hace lo mismo que el middleware, con el mismo fijado de
 * `app.tenant_id`, así que lo que pase acá es lo que va a pasar en producción.
 */
export async function conTenantFueraDePeticion<T>(
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId]);
    return await correrEnContexto({ cliente, tenantId, bypass: false }, fn);
  } finally {
    await cliente.query(`SELECT set_config('app.tenant_id', '', false)`).catch(() => undefined);
    cliente.release();
  }
}

export async function conBypassRlsFueraDePeticion<T>(fn: () => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('SELECT set_config($1, $2, false)', ['app.bypass_rls', 'on']);
    return await correrEnContexto({ cliente, tenantId: null, bypass: true }, fn);
  } finally {
    await cliente.query(`SELECT set_config('app.bypass_rls', '', false)`).catch(() => undefined);
    cliente.release();
  }
}
