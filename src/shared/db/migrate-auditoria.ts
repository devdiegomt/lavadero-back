/**
 * Migración: rastro de acciones del personal.
 * Ejecutar: npm run db:migrate-auditoria
 *
 * Sólo existía `appointment_status_log`, que cubre los cambios de estado de un
 * turno y nada más. Quién desactivó un usuario, quién cambió un precio, quién
 * borró un cliente o quién tocó las credenciales de facturación no quedaba en
 * ningún lado: la respuesta a "¿quién hizo esto?" era "no se puede saber".
 *
 * ## Qué se guarda, y sobre todo qué no
 *
 * **Nombres de campos, nunca valores.** Un registro dice "cambió `phone` y
 * `email` del cliente X", no cuáles eran antes ni cuáles son ahora. Es
 * deliberado y tiene dos razones:
 *
 * 1. Guardar los valores convertiría esta tabla en una **segunda copia de los
 *    datos personales**, con su propia obligación de retención bajo la Ley 1581
 *    y su propio riesgo si se filtra. Una bitácora de cumplimiento que crea un
 *    problema de cumplimiento es un mal negocio.
 * 2. También guardaría secretos de paso: contraseñas, tokens, la credencial de
 *    Alegra. Redactar caso por caso es una lista que se olvida de uno.
 *
 * Para el ~90% de las preguntas reales —quién, qué, cuándo, sobre qué— los
 * nombres de los campos alcanzan. Si algún día hace falta el antes/después de
 * algo puntual, se agrega para ese caso con los valores filtrados a mano, no
 * volviendo a guardar todo.
 *
 * **`user_email` va desnormalizado** junto a `user_id`. Un usuario se puede
 * desactivar o borrar, y un rastro que apunta a una fila que ya no existe no
 * sirve para reconstruir nada. Por lo mismo la FK es `ON DELETE SET NULL`: se
 * pierde el enlace, no el registro.
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
-- ============================================================================
-- ACTION_LOG: quién hizo qué, y cuándo
-- ============================================================================

CREATE TABLE IF NOT EXISTS action_log (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Puede ser NULL: el super_admin no tiene tenant.
    tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,

    -- SET NULL y no CASCADE: si el usuario se borra, el rastro queda.
    user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    user_email   VARCHAR(150),
    user_role    VARCHAR(20),

    method       VARCHAR(10) NOT NULL,
    -- El patrón de la ruta ('/api/customers/:id'), no la URL con el id
    -- adentro: asi se puede agrupar por accion.
    route        VARCHAR(200) NOT NULL,
    -- La entidad y el id concreto, cuando se pueden determinar.
    entity       VARCHAR(50),
    entity_id    UUID,

    status_code  SMALLINT NOT NULL,
    -- Nombres de los campos que venian en el cuerpo. NUNCA sus valores.
    fields       TEXT[],

    ip           VARCHAR(60),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE action_log IS
  'Rastro de acciones del personal sobre el panel. Guarda nombres de campos, nunca valores: ver la cabecera de migrate-auditoria.ts.';
COMMENT ON COLUMN action_log.fields IS
  'Nombres de los campos enviados. Sin valores, para no duplicar datos personales ni guardar secretos.';
COMMENT ON COLUMN action_log.user_email IS
  'Desnormalizado a proposito: el usuario se puede borrar y el rastro tiene que seguir sirviendo.';

-- El tablero de auditoría se lee por tenant y por fecha, de lo más nuevo a lo
-- más viejo. Es la consulta que va a correr siempre.
CREATE INDEX IF NOT EXISTS idx_action_log_tenant_fecha
    ON action_log(tenant_id, created_at DESC);

-- "Qué hizo esta persona" y "quién tocó este registro": las dos preguntas que
-- motivan tener la tabla.
CREATE INDEX IF NOT EXISTS idx_action_log_usuario
    ON action_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_log_entidad
    ON action_log(entity, entity_id, created_at DESC)
    WHERE entity_id IS NOT NULL;
`;

async function migrate(): Promise<void> {
  console.log('🔄 Creando el rastro de acciones...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 action_log (+3 índices)');
    console.log('   Guarda nombres de campos, nunca valores. Ver la cabecera del archivo.');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) migrate();
