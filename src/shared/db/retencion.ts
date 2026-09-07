/**
 * Retención de datos personales (Ley 1581).
 *
 * La ley pide conservar los datos sólo mientras la finalidad lo justifique.
 * Acá viven las dos tareas que lo hacen cumplir: purgar conversaciones viejas
 * y anonimizar clientes que dejaron de venir.
 *
 * **Los plazos son una decisión del responsable del tratamiento, no una
 * constante técnica.** Por eso salen de configuración, y poner `0` desactiva
 * la tarea. Los valores por defecto son un punto de partida defendible, no una
 * recomendación legal.
 *
 * A diferencia del resto de `shared/db`, este módulo sí importa `config`: no
 * es un script de migración que deba correr standalone, sino una tarea del
 * servidor, y los plazos merecen validarse al arrancar y no al vencerse.
 */
import * as db from './index';
import { config } from '../../config';
import logger from '../utils/logger';

/** Meses que se conservan las conversaciones. 0 desactiva la purga. */
const MESES_MENSAJES = config.DATA_RETENTION_MESSAGES_MONTHS;

/**
 * Meses de inactividad tras los cuales se anonimiza a un cliente.
 *
 * Desactivado por defecto: borrar los datos de un cliente es irreversible y
 * afecta la relación comercial del lavadero. Que lo active quien decide sobre
 * esos datos, no un valor que vino de fábrica.
 */
const MESES_CLIENTES = config.DATA_RETENTION_CUSTOMERS_MONTHS;

/**
 * Los campos que dejan de identificar a una persona.
 *
 * Vive en una constante porque lo usan la tarea automática y el derecho de
 * supresión: si mañana `customers` gana una columna con dato personal, hay un
 * solo lugar que corregir en vez de dos que se desincronizan.
 */
const CAMPOS_ANONIMIZADOS = `
  first_name      = 'Cliente',
  last_name       = NULL,
  phone           = NULL,
  email           = NULL,
  document_number = NULL,
  wa_lid          = NULL,
  notes           = NULL,
  anonymized_at   = NOW(),
  updated_at      = NOW()
`;

/**
 * Borra las conversaciones más viejas que el plazo configurado.
 *
 * `whatsapp_messages.content` guarda el texto literal de lo que escribió el
 * cliente: es el dato más sensible del sistema y el que menos justifica
 * conservarse indefinidamente.
 *
 * @param meses Plazo a aplicar. Por defecto el configurado; se puede pasar
 *   explícito para una purga puntual sin tocar el `.env`.
 */
export async function purgarMensajesViejos(meses: number = MESES_MENSAJES): Promise<number> {
  if (meses <= 0) return 0;

  try {
    const { rowCount } = await db.query(
      `DELETE FROM whatsapp_messages
       WHERE created_at < NOW() - ($1 || ' months')::interval`,
      [String(meses)],
    );
    const borrados = rowCount ?? 0;
    if (borrados > 0) {
      logger.info({ borrados, meses }, 'Mensajes purgados por retención');
    }
    return borrados;
  } catch (err) {
    logger.error({ err }, 'Error purgando mensajes');
    return 0;
  }
}

/**
 * Anonimiza clientes sin actividad en el plazo configurado.
 *
 * No los borra: los turnos siguen existiendo y contando para las estadísticas
 * del lavadero, pero dejan de estar asociados a una persona identificable. Un
 * `DELETE` rompería la integridad referencial y perdería el historial de
 * negocio, que no es dato personal.
 *
 * @param meses Plazo a aplicar. Por defecto el configurado.
 */
export async function anonimizarClientesInactivos(
  meses: number = MESES_CLIENTES,
): Promise<number> {
  if (meses <= 0) return 0;

  try {
    const { rowCount } = await db.query(
      `UPDATE customers
       SET ${CAMPOS_ANONIMIZADOS}
       WHERE anonymized_at IS NULL
         AND COALESCE(last_visit_at, created_at) < NOW() - ($1 || ' months')::interval`,
      [String(meses)],
    );
    const anonimizados = rowCount ?? 0;
    if (anonimizados > 0) {
      logger.info(
        { anonimizados, meses },
        'Clientes inactivos anonimizados por retención',
      );
    }
    return anonimizados;
  } catch (err) {
    logger.error({ err }, 'Error anonimizando clientes inactivos');
    return 0;
  }
}

/**
 * Anonimiza un cliente concreto: el derecho de supresión del titular.
 *
 * Se expone aparte de la tarea automática porque responde a una petición
 * puntual, que la ley obliga a atender sin esperar a que venza ningún plazo.
 * Va con `tenant_id` en el WHERE: un lavadero no puede borrar el cliente de
 * otro ni por error ni a propósito.
 */
export async function anonimizarCliente(
  tenantId: string,
  customerId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE customers
     SET ${CAMPOS_ANONIMIZADOS}
     WHERE tenant_id = $1 AND id = $2 AND anonymized_at IS NULL`,
    [tenantId, customerId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Clientes cuyos datos se guardaron sin autorización registrada.
 *
 * Son los creados antes de que existiera el paso de consentimiento. Sirve para
 * saber el tamaño del pasivo: la ley pide autorización de todos, no sólo de
 * los nuevos.
 */
export async function clientesSinAutorizacion(tenantId?: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM customers
     WHERE consent_at IS NULL
       AND anonymized_at IS NULL
       AND deleted_at IS NULL
       ${tenantId ? 'AND tenant_id = $1' : ''}`,
    tenantId ? [tenantId] : [],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Configuración vigente, para reportarla al arrancar. */
export const politicaRetencion = {
  mesesMensajes: MESES_MENSAJES,
  mesesClientes: MESES_CLIENTES,
};
