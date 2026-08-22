/**
 * Migración: identificar clientes de WhatsApp por su LID.
 * Ejecutar: npm run db:migrate-wa-lid
 *
 * WhatsApp multi-device no entrega el teléfono del remitente. Lo comprobamos
 * en producción: la key del mensaje trae sólo remoteJid (un @lid), fromMe e
 * id — no hay senderPn ni equivalente, y contacts.upsert nunca dispara.
 *
 * El @lid sí es estable por usuario, así que pasa a ser el identificador de
 * los clientes que llegan por WhatsApp. El teléfono queda como dato opcional
 * que se completa si el cliente lo da o si se carga desde el panel.
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
-- ============================================================================
-- CUSTOMERS: identificación por LID de WhatsApp
-- ============================================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS wa_lid VARCHAR(40);

COMMENT ON COLUMN customers.wa_lid IS
  'LID de WhatsApp (ej: 16733343588585@lid). Identificador estable del usuario; NO es un teléfono.';

-- El teléfono deja de ser obligatorio: un cliente que llega por WhatsApp no
-- lo trae, y meter el LID en esa columna corrompería las búsquedas.
ALTER TABLE customers ALTER COLUMN phone DROP NOT NULL;

-- Un cliente tiene que ser localizable de alguna forma.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customers_identidad;
ALTER TABLE customers ADD CONSTRAINT chk_customers_identidad
  CHECK (phone IS NOT NULL OR wa_lid IS NOT NULL);

-- Un LID pertenece a un solo cliente dentro del tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_wa_lid
  ON customers(tenant_id, wa_lid)
  WHERE wa_lid IS NOT NULL AND deleted_at IS NULL;

-- ============================================================================
-- WHATSAPP_MESSAGES: la auditoría también puede no tener teléfono
-- ============================================================================

ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS wa_lid VARCHAR(40);
ALTER TABLE whatsapp_messages ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE whatsapp_messages DROP CONSTRAINT IF EXISTS chk_wa_messages_identidad;
ALTER TABLE whatsapp_messages ADD CONSTRAINT chk_wa_messages_identidad
  CHECK (phone IS NOT NULL OR wa_lid IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_whatsapp_tenant_lid
  ON whatsapp_messages(tenant_id, wa_lid, created_at DESC)
  WHERE wa_lid IS NOT NULL;
`;

async function migrate(): Promise<void> {
  console.log('🔄 Ejecutando migración de LID de WhatsApp...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 customers.wa_lid + índice único por tenant');
    console.log('   📋 customers.phone ahora es opcional (con CHECK de identidad)');
    console.log('   📋 whatsapp_messages.wa_lid para auditar sin teléfono');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
