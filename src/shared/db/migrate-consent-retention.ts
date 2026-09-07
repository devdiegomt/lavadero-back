/**
 * Migración: autorización de tratamiento y retención de datos (Ley 1581).
 * Ejecutar: npm run db:migrate-consent
 *
 * La Ley 1581 de 2012 exige autorización previa, expresa e informada del
 * titular para tratar sus datos personales, y conservarlos sólo mientras la
 * finalidad lo justifique.
 *
 * Esta migración agrega lo necesario para dejar constancia de la autorización
 * —cuándo, con qué texto y por qué canal— y para poder anonimizar a un cliente
 * sin romper la integridad referencial de sus turnos.
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
-- ============================================================================
-- CUSTOMERS: autorización de tratamiento
-- ============================================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_version VARCHAR(20);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_source VARCHAR(20);

COMMENT ON COLUMN customers.consent_at IS
  'Cuándo autorizó el titular el tratamiento de sus datos (Ley 1581). NULL = sin autorización registrada.';
COMMENT ON COLUMN customers.consent_version IS
  'Versión del aviso de privacidad que aceptó. Permite saber qué se le informó.';
COMMENT ON COLUMN customers.consent_source IS
  'Canal por el que autorizó: whatsapp | panel | onboarding.';

-- ============================================================================
-- CUSTOMERS: anonimización
-- ============================================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

COMMENT ON COLUMN customers.anonymized_at IS
  'Cuándo se borraron sus datos personales conservando el registro. Los turnos siguen contando para estadísticas, sin identificar a nadie.';

-- Un cliente anonimizado no tiene teléfono ni LID: la restricción de
-- identidad tiene que admitirlo, o la anonimización sería imposible.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customers_identidad;
ALTER TABLE customers ADD CONSTRAINT chk_customers_identidad
  CHECK (phone IS NOT NULL OR wa_lid IS NOT NULL OR anonymized_at IS NOT NULL);

-- Para encontrar rápido a los inactivos al anonimizar.
CREATE INDEX IF NOT EXISTS idx_customers_last_visit
  ON customers(tenant_id, last_visit_at)
  WHERE anonymized_at IS NULL AND deleted_at IS NULL;

-- ============================================================================
-- WHATSAPP_MESSAGES: purga por antigüedad
-- ============================================================================

-- El contenido literal de las conversaciones es el dato más sensible del
-- sistema. La purga necesita poder recorrer por fecha sin escanear la tabla.
CREATE INDEX IF NOT EXISTS idx_whatsapp_created
  ON whatsapp_messages(created_at);
`;

async function migrate(): Promise<void> {
  console.log('🔄 Ejecutando migración de consentimiento y retención...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 customers.consent_at / consent_version / consent_source');
    console.log('   📋 customers.anonymized_at + CHECK de identidad ajustado');
    console.log('   📋 Índices para la purga de mensajes y la anonimización');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
