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
import { sendAppointmentReminders } from '../../modules/whatsapp/notifications';
import {
  purgarMensajesViejos,
  anonimizarClientesInactivos,
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
 * Inicializa todos los cron jobs. Llamar una vez desde index.ts.
 */
export function initCronJobs(): void {
  setInterval(cleanExpiredTokens,      6 * 60 * 60 * 1_000);    // cada 6h
  setInterval(refreshDailySummary,     15 * 60 * 1_000);         // cada 15 min
  setInterval(cleanOldBillingErrors,   24 * 60 * 60 * 1_000);    // cada 24h

  // Recordatorios de turno. La consulta busca los que caen entre 25 y 35
  // minutos por delante, asi que hay que pasar por esa ventana: cada 5 min
  // la cubre con margen. Sin esto la funcion existia pero nunca se ejecutaba,
  // y el bot prometia un aviso que no llegaba nunca.
  setInterval(() => { void sendAppointmentReminders(); }, 5 * 60 * 1_000);

  // Retención de datos personales (Ley 1581). Cada 24h alcanza: los plazos se
  // miden en meses, así que un día de holgura no cambia nada, y correrlo más
  // seguido sólo agrega DELETEs que no borran nada.
  setInterval(() => { void purgarMensajesViejos(); },        24 * 60 * 60 * 1_000);
  setInterval(() => { void anonimizarClientesInactivos(); }, 24 * 60 * 60 * 1_000);

  // Ejecutar limpieza al inicio
  cleanExpiredTokens();

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
    },
    'Política de retención de datos personales',
  );

  logger.info('Cron jobs inicializados');
}