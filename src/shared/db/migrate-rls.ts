/**
 * Migración: Row Level Security.
 * Ejecutar: npm run db:migrate-rls
 *
 * Hasta ahora el aislamiento entre lavaderos dependía **sólo de la disciplina**:
 * cada consulta lleva `tenant_id` en el `WHERE` por convención, y nada impedía
 * escribir una que lo olvidara. Con RLS el motor lo exige.
 *
 * ## Lo primero: el rol
 *
 * **RLS no aplica a superusuarios ni a roles con `BYPASSRLS`.** La aplicación se
 * conectaba como `postgres`, que es los dos, así que habilitar políticas sin
 * cambiar el rol habría dejado un esquema que *parece* protegido y en ejecución
 * no hace nada. Es el mismo engaño que ya pasó dos veces en este proyecto:
 * `validateId` puesto en una sola ruta y `decryptIfNeeded` aceptando texto
 * plano — leyendo el código parecía resuelto.
 *
 * Así que esta migración crea `carwash_app`: `NOSUPERUSER`, `NOBYPASSRLS`, con
 * permisos de datos y ninguno de esquema. **Hay que apuntarle `DATABASE_URL`**;
 * mientras no se haga, las políticas quedan inertes y el servidor avisa al
 * arrancar (ver `shared/db/rls.ts`).
 *
 * ## Cómo sabe el motor de qué tenant se trata
 *
 * De `current_setting('app.tenant_id')`, que la aplicación fija por petición
 * sobre la conexión que va a usar. Ver `shared/db/contexto.ts`.
 *
 * El segundo argumento de `current_setting` es `missing_ok`: si nadie lo fijó
 * devuelve NULL, la comparación da NULL y **no se ve ninguna fila**. Falla
 * cerrado a propósito: una ruta que se olvide de abrir el contexto devuelve
 * vacío, que se nota enseguida. Al revés —fallar abierto— el olvido no se nota
 * nunca y es justamente la fuga que se viene a evitar.
 *
 * ## La puerta de atrás, que es deliberada
 *
 * `app.bypass_rls = 'on'` saltea las políticas. Existe porque hay tres caminos
 * que legítimamente no tienen tenant todavía:
 *
 * - **Autenticación.** El login busca al usuario por email, antes de saber de qué
 *   lavadero es. Es el orden inevitable: no se puede filtrar por tenant para
 *   averiguar el tenant.
 * - **Onboarding.** Crea el tenant; no puede filtrar por algo que todavía no
 *   existe.
 * - **Super admin.** Su trabajo es ver todos los lavaderos.
 *
 * Es un agujero y conviene nombrarlo como tal. La diferencia con no tener RLS es
 * que ahora el agujero está en tres middlewares que se pueden leer en un minuto,
 * en vez de repartido en 212 consultas.
 */
import 'dotenv/config';
import { pool } from './index';

/**
 * Tablas aisladas por `tenant_id`, **descubiertas**, no enumeradas.
 *
 * La primera versión llevaba una lista escrita a mano. Con eso, agregar una
 * tabla con `tenant_id` en una migración futura la dejaba sin política y sin que
 * nada avisara: un agujero de aislamiento creado por omisión, que es justamente
 * la forma de fallo que RLS viene a evitar. Preguntarle al catálogo es lo mismo
 * de escribir y no se olvida.
 */
async function tablasPorTenant(): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT c.table_name
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'tenant_id'
       AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name`,
  );
  return rows.map((r) => r.table_name);
}

/**
 * El rol de la aplicación.
 *
 * La contraseña sale del entorno. Si no está, el rol se crea igual sin tocar la
 * que tenga —para poder correr la migración dos veces sin romper nada— y se
 * avisa.
 */
const ROL = 'carwash_app';

function sqlDelRol(password: string | undefined): string {
  const conPassword = password
    ? `ALTER ROLE ${ROL} WITH LOGIN PASSWORD ${literal(password)};`
    : '';

  return `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROL}') THEN
    CREATE ROLE ${ROL} LOGIN;
  END IF;
END $$;

-- Explícito y no por omisión: son las dos propiedades de las que depende que
-- todo esto sirva para algo.
ALTER ROLE ${ROL} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
${conPassword}

-- Permisos de datos, ninguno de esquema: la aplicación no crea ni altera
-- tablas. Eso lo hacen las migraciones, que corren con el rol dueño.
GRANT USAGE ON SCHEMA public TO ${ROL};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROL};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROL};

-- Para las tablas que se creen después: sin esto, agregar una tabla en una
-- migración nueva la deja invisible para la aplicación y el síntoma es un
-- "permission denied" que no señala a esta línea.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROL};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ${ROL};
`;
}

/** Escapa una cadena para SQL. Es una contraseña y va a un DDL, no a un $1. */
function literal(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}

function sqlDePoliticas(tablas: readonly string[]): string {
  const porTenant = tablas.map(
    (tabla) => `
ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY;
-- FORCE para que tampoco el dueño de la tabla se saltee las políticas. A un
-- superusuario no lo alcanza igual: eso se resuelve con el rol, no con SQL.
ALTER TABLE ${tabla} FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ${tabla}_por_tenant ON ${tabla};
CREATE POLICY ${tabla}_por_tenant ON ${tabla}
  USING (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );`,
  ).join('\n');

  // `tenants` se aísla por su propia clave, no por `tenant_id`.
  const tenants = `
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_propio ON tenants;
CREATE POLICY tenants_propio ON tenants
  USING (
    id = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  )
  WITH CHECK (
    id = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );`;

  // Las que cuelgan de otra tabla en vez de llevar `tenant_id`. Se resuelven con
  // EXISTS sobre la tabla padre, que ya está protegida: si el padre no se ve,
  // tampoco la hija.
  const derivadas = `
ALTER TABLE appointment_status_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_status_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_status_log_por_turno ON appointment_status_log;
CREATE POLICY appointment_status_log_por_turno ON appointment_status_log
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM appointments a
      WHERE a.id = appointment_status_log.appointment_id
        AND a.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM appointments a
      WHERE a.id = appointment_status_log.appointment_id
        AND a.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    )
  );`;

  return porTenant + tenants + derivadas;
}

/**
 * `plans` y `refresh_tokens` quedan **sin** RLS, a propósito:
 *
 * - `plans` es el catálogo global de la plataforma. No es de nadie.
 * - `refresh_tokens` se consulta por el hash del token, antes de saber de qué
 *   tenant es la sesión — el mismo problema de orden que la autenticación. Lo
 *   que lo protege es que sólo guarda hashes: quien lea la tabla no puede
 *   suplantar a nadie.
 */
async function migrate(): Promise<void> {
  console.log('🔄 Habilitando Row Level Security...');
  try {
    const password = process.env.DB_APP_PASSWORD;
    if (!password) {
      console.log('   ⚠️  DB_APP_PASSWORD no está definida: el rol se crea/actualiza sin');
      console.log('      tocar su contraseña. Definila y volvé a correr esto para fijarla.');
    }

    await pool.query(sqlDelRol(password));
    console.log(`   👤 Rol ${ROL} (NOSUPERUSER, NOBYPASSRLS) con permisos de datos`);

    const tablas = await tablasPorTenant();
    await pool.query(sqlDePoliticas(tablas));
    console.log(`   🔒 RLS en ${tablas.length + 2} tablas (${tablas.join(', ')})`);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_policies WHERE schemaname = 'public'`,
    );
    console.log(`   📋 ${rows[0].n} políticas activas`);

    console.log('✅ Migración completada');
    console.log('');
    console.log('   ⚠️  FALTA EL PASO QUE LO ACTIVA: apuntar DATABASE_URL a ' + ROL + '.');
    console.log('      Mientras siga conectando como un superusuario, las políticas');
    console.log('      están ahí y no hacen nada — PostgreSQL no aplica RLS a');
    console.log('      superusuarios ni a roles con BYPASSRLS. El servidor lo avisa al');
    console.log('      arrancar.');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) migrate();

export { tablasPorTenant, ROL };
