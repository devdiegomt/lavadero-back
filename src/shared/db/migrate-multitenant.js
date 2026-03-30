/**
 * Migración Fase 5: Multi-tenant — Planes, límites y super admin.
 * Ejecutar: node src/shared/db/migrate-multitenant.js
 */
require('dotenv').config();
const { pool } = require('./index');

const migration = `
-- ============================================================================
-- PLANS (Definición de planes comerciales)
-- ============================================================================
CREATE TABLE IF NOT EXISTS plans (
    id              VARCHAR(20) PRIMARY KEY,  -- 'free', 'basic', 'pro'
    name            VARCHAR(50) NOT NULL,
    price_monthly   INTEGER NOT NULL DEFAULT 0,  -- COP centavos
    max_operators   SMALLINT NOT NULL DEFAULT 2,
    max_appointments_month SMALLINT NOT NULL DEFAULT 100,
    max_services    SMALLINT NOT NULL DEFAULT 5,
    max_bays        SMALLINT NOT NULL DEFAULT 2,
    whatsapp_enabled BOOLEAN DEFAULT false,
    billing_enabled  BOOLEAN DEFAULT false,
    reports_enabled  BOOLEAN DEFAULT true,
    is_active       BOOLEAN DEFAULT true,
    sort_order      SMALLINT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar planes por defecto (idempotente)
INSERT INTO plans (id, name, price_monthly, max_operators, max_appointments_month, max_services, max_bays, whatsapp_enabled, billing_enabled, reports_enabled, sort_order)
VALUES
  ('free',  'Gratis',  0,        1,  50,   3,  1, false, false, false, 1),
  ('basic', 'Básico',  9900000,  3,  500,  10, 3, false, true,  true,  2),
  ('pro',   'Pro',     19900000, 10, 2000, 50, 8, true,  true,  true,  3)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- TENANT USAGE (Conteo mensual de uso por tenant)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenant_usage (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    month           DATE NOT NULL,  -- Primer día del mes (ej: 2026-03-01)
    appointments    INTEGER DEFAULT 0,
    operators       SMALLINT DEFAULT 0,
    services        SMALLINT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_usage_month UNIQUE (tenant_id, month)
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage ON tenant_usage(tenant_id, month DESC);

-- ============================================================================
-- SUPER ADMIN USERS (usuarios sin tenant, con rol super_admin)
-- Se crean directamente en la tabla users con tenant_id = NULL
-- ============================================================================
-- No se necesita tabla nueva, solo un usuario con role='super_admin' y tenant_id=NULL

-- ============================================================================
-- ONBOARDING LOG (registro de onboardings para tracking)
-- ============================================================================
CREATE TABLE IF NOT EXISTS onboarding_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    step            VARCHAR(30) NOT NULL,  -- 'tenant_created', 'admin_created', 'services_added', 'completed'
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_tenant ON onboarding_log(tenant_id);

-- ============================================================================
-- Agregar campo plan_limits_checked a tenants (para cache de fecha de último chequeo)
-- ============================================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='plan_limits_checked_at') THEN
        ALTER TABLE tenants ADD COLUMN plan_limits_checked_at TIMESTAMPTZ;
    END IF;
END $$;
`;

async function migrate() {
  console.log('🔄 Ejecutando migración Fase 5 (Multi-tenant)...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 Tabla plans con 3 planes (free, basic, pro)');
    console.log('   📋 Tabla tenant_usage para conteo mensual');
    console.log('   📋 Tabla onboarding_log para tracking');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
