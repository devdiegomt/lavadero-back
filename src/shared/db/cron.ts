/**
 * Tareas programadas (cron jobs).
 *
 * Se ejecutan con setInterval. Para producción real considerar
 * node-cron o pg_cron si la complejidad lo amerita.
 *
 * Inicializar desde index.ts:
 *   import { initCronJobs } from './shared/db/cron';
 *   initCronJobs();
 */

import * as db from './index';
import logger from '../utils/logger';
import { conBypassRlsFueraDePeticion } from '../middleware/rls';
import { sendAppointmentReminders } from '../../modules/whatsapp/notifications';
import {
  purgarMensajesViejos,
  anonimizarClientesInactivos,
  purgarAuditoriaVieja,
  politicaRetencion,
} from './retencion';

/**
 * Limpia refresh tokens expirados o revocados (> 1 día).
 * Ejecutar cada 6 horas.
 */
export async function cleanExpiredTokens(): Promise<void> {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM refresh_tokens
       WHERE expires_at < NOW() - INTERVAL '1 day'
          OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '1 day')`,
    );
    if (rowCount && rowCount > 0) {
      logger.info({ cleaned: rowCount }, 'Tokens expirados limpiados');
    }
  } catch (err) {
    logger.error({ err }, 'Error limpiando tokens');
  }
}

/**
 * Refresca la materialized view mv_daily_summary.
 * Ejecutar cada 15 minutos.
 *
 * Intenta CONCURRENTLY primero (no bloquea reads); si falla
 * (por ej. la vista no tiene índice único todavía), cae al refresh normal.
 */
export async function refreshDailySummary(): Promise<void> {
  try {
    await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_summary');
  } catch {
    try {
      await db.query('REFRESH MATERIALIZED VIEW mv_daily_summary');
    } catch (err) {
      logger.error({ err }, 'Error refrescando mv_daily_summary');
    }
  }
}

/**
 * Limpia billing_errors resueltos de más de 30 días.
 * Ejecutar cada 24 horas.
 */
export async function cleanOldBillingErrors(): Promise<void> {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM billing_errors
       WHERE resolved_at IS NOT NULL AND resolved_at < NOW() - INTERVAL '30 days'`,
    );
    if (rowCount && rowCount > 0) {
      logger.info({ cleaned: rowCount }, 'Billing errors antiguos limpiados');
    }
  } catch (err) {
    logger.error({ err }, 'Error limpiando billing errors');
  }
}

/**
 * Corre una tarea programada sin que pueda tumbar el proceso.
 *
 * **Esto no es precaución de más: ya tiró producción.** Los cuatro intervalos de
 * abajo empezaban con `void conBypassRlsFueraDePeticion(...)` y sin `catch`. En
 * Node 20 una promesa rechazada sin manejar **termina el proceso**, así que
 * cuando la base de datos dejó de resolver por DNS, el primer recordatorio que
 * tocaba —cada 5 minutos— mataba la API entera:
 *
 *     Error: getaddrinfo ENOTFOUND dpg-…
 *         at async conBypassRlsFueraDePeticion (…/rls.js:146:21)
 *     Node.js v20.20.2
 *
 * Render lo reiniciaba, arrancaba, y a los 5 minutos otra vez. Un ciclo de
 * caídas por una dependencia que sólo hacía falta para limpiar filas viejas.
 *
 * El `try/catch` que ya tenían `cleanExpiredTokens` y las demás **no alcanzaba**:
 * lo que falla es `pool.connect()` dentro del envoltorio, antes de que la tarea
 * llegue a correr. El manejo tiene que estar acá, en quien la programa.
 *
 * Es la tercera vez que este proyecto se cae por lo mismo —antes fueron las seis
 * rutas de `wa-bridge` sin `asyncHandler`— y la lección es la misma: **una
 * promesa que nadie espera necesita un `catch`, siempre.**
 */
export async function correrTarea(
  nombre: string,
  // `unknown` y no `void`: varias de estas devuelven cuántas filas tocaron.
  tarea: () => Promise<unknown>,
): Promise<void> {
  try {
    await tarea();
  } catch (err) {
    // Que una tarea de fondo falle es un problema; que se lleve puesta la API es
    // otro mucho peor. Se anota y el servidor sigue atendiendo.
    logger.error({ err, tarea: nombre }, 'Tarea programada falló');
  }
}

/** `setInterval`, pero sin la forma de tumbar el proceso. Usar siempre esta. */
function programar(nombre: string, cadaMs: number, tarea: () => Promise<unknown>): void {
  setInterval(() => {
    void correrTarea(nombre, tarea);
  }, cadaMs);
}

/**
 * Inicializa todos los cron jobs. Llamar una vez desde index.ts.
 */
export function initCronJobs(): void {
  const HORA = 60 * 60 * 1_000;
  const MINUTO = 60 * 1_000;

  programar('cleanExpiredTokens', 6 * HORA, cleanExpiredTokens);
  programar('refreshDailySummary', 15 * MINUTO, refreshDailySummary);
  programar('cleanOldBillingErrors', 24 * HORA, cleanOldBillingErrors);

  // Recordatorios de turno. La consulta busca los que caen entre 25 y 35
  // minutos por delante, asi que hay que pasar por esa ventana: cada 5 min
  // la cubre con margen. Sin esto la funcion existia pero nunca se ejecutaba,
  // y el bot prometia un aviso que no llegaba nunca.
  // Con bypass explícito: recorre TODOS los tenants a propósito, y fuera de una
  // petición no hay contexto del que partir. Que tenga que pedirlo hace visible
  // en el código que cruza tenants, en vez de que funcione por casualidad.
  programar('sendAppointmentReminders', 5 * MINUTO, () =>
    conBypassRlsFueraDePeticion(() => sendAppointmentReminders()),
  );

  // Retención de datos personales (Ley 1581). Cada 24h alcanza: los plazos se
  // miden en meses, así que un día de holgura no cambia nada, y correrlo más
  // seguido sólo agrega DELETEs que no borran nada.
  programar('purgarMensajesViejos', 24 * HORA, () =>
    conBypassRlsFueraDePeticion(() => purgarMensajesViejos()),
  );
  programar('anonimizarClientesInactivos', 24 * HORA, () =>
    conBypassRlsFueraDePeticion(() => anonimizarClientesInactivos()),
  );
  programar('purgarAuditoriaVieja', 24 * HORA, () =>
    conBypassRlsFueraDePeticion(() => purgarAuditoriaVieja()),
  );

  // Ejecutar limpieza al inicio
  void correrTarea('cleanExpiredTokens', cleanExpiredTokens);

  // Se registra al arrancar para que la política vigente quede en el log: si
  // alguien pregunta cuánto tiempo se guardan las conversaciones, la respuesta
  // no depende de adivinar qué valor tenía el .env ese día.
  logger.info(
    {
      mensajes: politicaRetencion.mesesMensajes
        ? `${politicaRetencion.mesesMensajes} meses`
        : 'sin purga',
      clientes: politicaRetencion.mesesClientes
        ? `${politicaRetencion.mesesClientes} meses`
        : 'sin anonimización automática',
      auditoria: politicaRetencion.mesesAuditoria
        ? `${politicaRetencion.mesesAuditoria} meses`
        : 'sin purga',
    },
    'Política de retención de datos personales',
  );

  logger.info('Cron jobs inicializados');
}