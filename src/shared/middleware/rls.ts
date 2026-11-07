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
import type { PoolClient } from 'pg';
import logger from '../utils/logger';

/**
 * Abre el contexto con el tenant de `req.tenantId`.
 *
 * Va **después** de `requireTenant`, que es quien lo pone. Si no hay tenant
 * —super admin, o una ruta pública— sigue sin abrir nada: esas consultas van al
 * pool y las bloquea RLS salvo que pasen por `conBypassRls`.
 */
/**
 * Devuelve una conexión al pool, pase lo que pase con la limpieza.
 *
 * Antes de devolverla hay que borrar el ajuste de sesión —`app.tenant_id` o
 * `app.bypass_rls`— porque la conexión vuelve al pool y la próxima petición la
 * heredaría. Eso es una consulta más, y **el `release()` colgaba de que esa
 * consulta respondiera**:
 *
 *     cliente.query(...).catch(...).finally(() => cliente.release());
 *
 * Si no responde, la conexión no vuelve nunca. Con `max: 10`, diez de ésas y
 * toda la API contesta 500 — que es exactamente el cuadro que apareció en CI:
 * diez conexiones `idle` en PostgreSQL, la más vieja de hace minuto y medio, y
 * `pool.connect()` dando timeout a los 5 s.
 *
 * **No está confirmado que ésa fuera la causa** —no se pudo reproducir fuera de
 * CI, y sólo pasa con WebKit—. Pero un camino de liberación que depende de que
 * una consulta responda no es un camino de liberación, y eso vale arreglarlo
 * aunque después resulte que el fallo era otro.
 *
 * El corte a los 2 s deja rastro: si aparece en el log, la hipótesis era buena.
 *
 * (Noviembre: el pool se volvió a agotar con esto puesto. La fuga que sí estaba
 * confirmada es la de `vigilarCierre`, más abajo.)
 */
function devolverAlPool(cliente: PoolClient, ajuste: string, ruta: string): void {
  let devuelta = false;
  const soltar = (porCorte: boolean): void => {
    if (devuelta) return;
    devuelta = true;
    if (porCorte) {
      logger.error(
        { ruta, ajuste },
        'La limpieza del contexto no respondió en 2 s: se devuelve la conexión igual',
      );
    }
    cliente.release();
  };

  const corte = setTimeout(() => soltar(true), 2_000);

  cliente
    .query(`SELECT set_config('${ajuste}', '', false)`)
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(corte);
      soltar(false);
    });
}

/**
 * Avisa si la petición se cortó mientras se esperaba la conexión.
 *
 * Los middlewares de abajo se suscriben a `res.on('close')` para devolver la
 * conexión, pero sólo pueden hacerlo **después** de tenerla, y conseguirla es
 * esperar a `pool.connect()`. Si el navegador corta la petición durante esa
 * espera —Firefox y WebKit cancelan lo que esté en vuelo al navegar—, `close`
 * ya sonó y no vuelve a sonar: la conexión no se devolvía nunca.
 *
 * Pasó en el CI del panel, con el mismo cuadro que la vez anterior: diez
 * conexiones tomadas, las diez `idle` en PostgreSQL, y cada login dando 500 a
 * los 5 s. Y se alimenta solo: cuanto más ocupado el pool, más larga la espera
 * y más ancha la ventana. Lo reproduce `conexion-de-peticion-cortada.test.ts`.
 *
 * Se mira el cierre desde **antes** de pedir la conexión; la función que
 * devuelve dice si llegó a cerrarse, y deja de mirar.
 */
function vigilarCierre(res: Response): () => boolean {
  let cerrada = res.destroyed || res.writableFinished;
  const marcar = (): void => {
    cerrada = true;
  };
  res.once('close', marcar);
  return () => {
    res.off('close', marcar);
    return cerrada;
  };
}

export async function abrirContextoDeTenant(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const tenantId = req.tenantId;
  if (!tenantId) return next();

  const seCorto = vigilarCierre(res);

  let cliente;
  try {
    cliente = await pool.connect();
  } catch (err) {
    seCorto();
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
    seCorto();
    cliente.release();
    next(err);
    return;
  }

  // El navegador ya se fue: no hay a quién responder, y nadie va a avisar
  // cuándo devolver la conexión. Se devuelve ahora.
  if (seCorto()) {
    devolverAlPool(cliente, 'app.tenant_id', req.originalUrl);
    return;
  }

  // Liberar cuando la respuesta termine, pase lo que pase. Sin esto, una
  // excepción a mitad de camino deja la conexión tomada para siempre y el pool
  // se agota de a poco — un síntoma que aparece horas después y lejos.
  let liberada = false;
  const liberar = (): void => {
    if (liberada) return;
    liberada = true;
    devolverAlPool(cliente, 'app.tenant_id', req.originalUrl);
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
    const seCorto = vigilarCierre(res);

    let cliente;
    try {
      cliente = await pool.connect();
      await cliente.query('SELECT set_config($1, $2, false)', ['app.bypass_rls', 'on']);
    } catch (err) {
      seCorto();
      cliente?.release();
      logger.error({ err, motivo }, 'No se pudo abrir el contexto con bypass de RLS');
      next(err);
      return;
    }

    // Igual que arriba: cortada durante la espera, se devuelve ya.
    if (seCorto()) {
      devolverAlPool(cliente, 'app.bypass_rls', req.originalUrl);
      return;
    }

    let liberada = false;
    const liberar = (): void => {
      if (liberada) return;
      liberada = true;
      devolverAlPool(cliente, 'app.bypass_rls', req.originalUrl);
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
 * Abre el contexto del lavadero que nombra `:slug`, para la página pública de
 * reservas.
 *
 * No hay sesión de la que sacar el tenant: se busca por slug, y eso necesita
 * la puerta de atrás —no se puede filtrar por tenant para averiguar el
 * tenant—. Pero **sólo para esa búsqueda**: se hace dentro de una transacción
 * con `set_config(..., true)`, que se deshace sola al terminar (también si
 * falla), y después la conexión queda con `app.tenant_id` fijado como en
 * cualquier petición del panel. Todo lo que la reserva lea o escriba pasa por
 * RLS, acotado a ese lavadero.
 *
 * La alternativa —`conBypassRls` en toda la ruta— dejaría las inserciones de
 * clientes y turnos de una ruta anónima sin la red de RLS. Ver
 * docs/05-seguridad.md §3.
 *
 * Un slug con forma inválida o de un lavadero inactivo responde 404, igual que
 * uno que no existe.
 */
export async function abrirContextoPorSlug(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const slug = String(req.params.slug ?? '').toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
    res.status(404).json({ error: 'Lavadero no encontrado' });
    return;
  }

  const seCorto = vigilarCierre(res);

  let cliente: PoolClient;
  try {
    cliente = await pool.connect();
  } catch (err) {
    seCorto();
    logger.error({ err }, 'No se pudo tomar una conexión para la página pública');
    next(err);
    return;
  }

  let tenantId: string | null = null;
  try {
    await cliente.query('BEGIN');
    // `true`: local a la transacción. Al COMMIT o ROLLBACK vuelve a vacío.
    await cliente.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
    const { rows } = await cliente.query<{ id: string }>(
      'SELECT id FROM tenants WHERE slug = $1 AND is_active = true',
      [slug],
    );
    await cliente.query('COMMIT');
    tenantId = rows[0]?.id ?? null;
    if (tenantId) {
      await cliente.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId]);
    }
  } catch (err) {
    seCorto();
    await cliente.query('ROLLBACK').catch(() => undefined);
    devolverAlPool(cliente, 'app.tenant_id', req.originalUrl);
    next(err);
    return;
  }

  if (seCorto()) {
    devolverAlPool(cliente, 'app.tenant_id', req.originalUrl);
    return;
  }
  if (!tenantId) {
    devolverAlPool(cliente, 'app.tenant_id', req.originalUrl);
    res.status(404).json({ error: 'Lavadero no encontrado' });
    return;
  }

  req.tenantId = tenantId;

  let liberada = false;
  const liberar = (): void => {
    if (liberada) return;
    liberada = true;
    devolverAlPool(cliente, 'app.tenant_id', req.originalUrl);
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
