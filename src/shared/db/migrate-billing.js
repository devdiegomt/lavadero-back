/**
 * Migración Fase 4: Tablas de facturación electrónica.
 * 
 * Ejecutar: node src/shared/db/migrate-billing.js
 * 
 * Tablas nuevas:
 *   - billing_sync: Mapeo de IDs locales ↔ Alegra
 *   - billing_errors: Log de errores de facturación
 * 
 * Cambios en tablas existentes:
 *   - payments: ya tiene los campos invoice_* (creados en migrate.js original)
 */

require('dotenv').config();
const { pool } = require('./index');

const migration = `
-- ============================================================================
-- BILLING SYNC (Mapeo de IDs Carwash ↔ Alegra)
-- ============================================================================
CREATE TABLE IF NOT EXISTS billing_sync (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entity_type     VARCHAR(20) NOT NULL,  -- 'customer', 'service'
    local_id        VARCHAR(100) NOT NULL, -- UUID del registro local (o composite key)
    external_id     VARCHAR(50) NOT NULL,  -- ID en Alegra
    metadata        JSONB DEFAULT '{}',    -- Datos extra (ej: precio al momento del sync)
    synced_at       TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_billing_sync UNIQUE (tenant_id, entity_type, local_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_sync_tenant
    ON billing_sync(tenant_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_billing_sync_external
    ON billing_sync(tenant_id, external_id);

-- ============================================================================
-- BILLING ERRORS (Log de errores para diagnóstico y reintentos)
-- ============================================================================
CREATE TABLE IF NOT EXISTS billing_errors (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    payment_id      UUID REFERENCES payments(id),
    error_message   TEXT NOT NULL,
    error_details   JSONB DEFAULT '{}',
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_errors_tenant
    ON billing_errors(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_errors_unresolved
    ON billing_errors(tenant_id) WHERE resolved_at IS NULL;

-- ============================================================================
-- Asegurar que la columna invoice_status tenga valor por defecto correcto
-- (no es estrictamente necesario si ya existe, pero es idempotente)
-- ============================================================================
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payments' AND column_name = 'invoice_status'
    ) THEN
        ALTER TABLE payments ADD COLUMN invoice_status VARCHAR(20);
    END IF;
END $$;
`;

async function migrate() {
  console.log('🔄 Ejecutando migración de facturación (Fase 4)...');
  try {
    await pool.query(migration);
    console.log('✅ Migración de facturación completada');
    console.log('   📋 Tablas creadas: billing_sync, billing_errors');
    console.log('   📋 La tabla payments ya tiene campos invoice_*');
  } catch (err) {
    console.error('❌ Error en migración:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
