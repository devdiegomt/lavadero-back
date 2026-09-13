/**
 * Verifica al arrancar que RLS **esté haciendo algo**.
 *
 * Existe por una razón concreta: PostgreSQL no aplica políticas de RLS a
 * superusuarios ni a roles con `BYPASSRLS`. Si `DATABASE_URL` apunta a
 * `postgres`, las políticas están en el esquema, se ven al hacer `\\d+`, y en
 * ejecución no hacen nada.
 *
 * Eso es peor que no tenerlas: el esquema afirma una protección que no existe. En
 * este proyecto ya pasó dos veces —`validateId` puesto en una sola ruta,
 * `decryptIfNeeded` aceptando texto plano— y las dos veces el problema fue que
 * leyendo el código parecía resuelto. Esta función es para que no haya una
 * tercera con el aislamiento entre lavaderos.
 */
import * as db from './index';
import logger from '../utils/logger';

export interface EstadoRls {
  rol: string;
  esSuperusuario: boolean;
  salteaRls: boolean;
  tablasConRls: number;
  politicas: number;
  /** Si las políticas se aplican de verdad al rol con el que se conecta. */
  activo: boolean;
}

export async function estadoRls(): Promise<EstadoRls> {
  const { rows } = await db.query<{
    rol: string;
    super: boolean;
    bypass: boolean;
  }>(
    `SELECT current_user AS rol, rolsuper AS super, rolbypassrls AS bypass
     FROM pg_roles WHERE rolname = current_user`,
  );

  const { rows: tablas } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity`,
  );

  const { rows: pol } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pg_policies WHERE schemaname = 'public'`,
  );

  const esSuperusuario = rows[0]?.super ?? false;
  const salteaRls = rows[0]?.bypass ?? false;
  const tablasConRls = parseInt(tablas[0].n, 10);

  return {
    rol: rows[0]?.rol ?? 'desconocido',
    esSuperusuario,
    salteaRls,
    tablasConRls,
    politicas: parseInt(pol[0].n, 10),
    activo: tablasConRls > 0 && !esSuperusuario && !salteaRls,
  };
}

/**
 * Lo registra al arrancar. No aborta: un lavadero que está operando no puede
 * quedarse sin servidor por una advertencia de configuración. Pero el mensaje
 * dice exactamente qué hacer.
 */
export async function verificarRls(): Promise<void> {
  try {
    const e = await estadoRls();

    if (e.activo) {
      logger.info(
        { rol: e.rol, tablas: e.tablasConRls, politicas: e.politicas },
        'Row Level Security activo: el aislamiento entre lavaderos lo exige el motor',
      );
      return;
    }

    if (e.tablasConRls === 0) {
      logger.warn(
        'Sin políticas de RLS: el aislamiento entre lavaderos depende sólo de que ' +
          'cada consulta lleve tenant_id. Correr: npm run db:migrate-rls',
      );
      return;
    }

    logger.error(
      { rol: e.rol, esSuperusuario: e.esSuperusuario, salteaRls: e.salteaRls },
      `Las políticas de RLS existen pero NO se aplican: "${e.rol}" las saltea por ser ` +
        'superusuario o tener BYPASSRLS. El esquema afirma una protección que en ' +
        'ejecución no existe. Apuntar DATABASE_URL al rol carwash_app.',
    );
  } catch (err) {
    logger.error({ err }, 'No se pudo verificar el estado de RLS');
  }
}
