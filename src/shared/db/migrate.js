/**
 * Migración inicial - Crea todas las tablas del schema.
 * Ejecutar: npm run db:migrate
 *
 * NOTA: Esto es suficiente para un solo dev. Si luego necesitas migraciones
 * incrementales, agrega una librería como node-pg-migrate. No antes.
 */
require('dotenv').config();
const { pool } = require('./index');

const migration = `
-- Extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- TENANTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(150) NOT NULL,
    slug            VARCHAR(80) UNIQUE NOT NULL,
    nit             VARCHAR(20),
    owner_name      VARCHAR(150),
    phone           VARCHAR(20),
    email           VARCHAR(150),
    address         VARCHAR(300),
    city            VARCHAR(100) DEFAULT 'Bogotá',
    timezone        VARCHAR(50) DEFAULT 'America/Bogota',
    opening_time    TIME DEFAULT '07:00',
    closing_time    TIME DEFAULT '19:00',
    bays_count      SMALLINT DEFAULT 3,
    currency        VARCHAR(3) DEFAULT 'COP',
    plan            VARCHAR(20) DEFAULT 'basic',
    is_active       BOOLEAN DEFAULT true,
    trial_ends_at   TIMESTAMPTZ,
    billing_provider    VARCHAR(20),
    billing_api_key     TEXT,
    billing_resolution  VARCHAR(50),
    billing_prefix      VARCHAR(10),
    whatsapp_provider   VARCHAR(20),
    whatsapp_phone      VARCHAR(20),
    whatsapp_enabled    BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug) WHERE is_active = true;

-- ============================================================================
-- USERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
    email           VARCHAR(150) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    first_name      VARCHAR(80) NOT NULL,
    last_name       VARCHAR(80),
    phone           VARCHAR(20),
    role            VARCHAR(20) NOT NULL DEFAULT 'operator',
    is_active       BOOLEAN DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_users_email_tenant UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================================
-- REFRESH TOKENS
-- ============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

-- ============================================================================
-- CUSTOMERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS customers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    first_name      VARCHAR(80) NOT NULL,
    last_name       VARCHAR(80),
    phone           VARCHAR(20) NOT NULL,
    email           VARCHAR(150),
    document_type   VARCHAR(5) DEFAULT 'CC',
    document_number VARCHAR(20),
    notes           TEXT,
    visit_count     INTEGER DEFAULT 0,
    last_visit_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(tenant_id, phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_document ON customers(tenant_id, document_number)
    WHERE deleted_at IS NULL AND document_number IS NOT NULL;

-- ============================================================================
-- VEHICLES
-- ============================================================================
CREATE TABLE IF NOT EXISTS vehicles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    plate           VARCHAR(10) NOT NULL,
    vehicle_type    VARCHAR(20) DEFAULT 'sedan',
    brand           VARCHAR(50),
    model           VARCHAR(50),
    color           VARCHAR(30),
    year            SMALLINT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_plate_tenant
    ON vehicles(tenant_id, UPPER(plate)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant ON vehicles(tenant_id) WHERE deleted_at IS NULL;

-- ============================================================================
-- SERVICES
-- ============================================================================
CREATE TABLE IF NOT EXISTS services (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    price_sedan     INTEGER NOT NULL DEFAULT 0,
    price_suv       INTEGER NOT NULL DEFAULT 0,
    price_camioneta INTEGER NOT NULL DEFAULT 0,
    price_moto      INTEGER NOT NULL DEFAULT 0,
    price_pickup    INTEGER NOT NULL DEFAULT 0,
    estimated_minutes SMALLINT DEFAULT 60,
    is_active       BOOLEAN DEFAULT true,
    sort_order      SMALLINT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_tenant ON services(tenant_id) WHERE is_active = true;

-- ============================================================================
-- APPOINTMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS appointments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id     UUID NOT NULL REFERENCES customers(id),
    vehicle_id      UUID NOT NULL REFERENCES vehicles(id),
    service_id      UUID NOT NULL REFERENCES services(id),
    assigned_to     UUID REFERENCES users(id),
    scheduled_date  DATE NOT NULL,
    scheduled_time  TIME,
    bay_number      SMALLINT,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    price           INTEGER NOT NULL DEFAULT 0,
    source          VARCHAR(20) DEFAULT 'walk_in',
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_daily
    ON appointments(tenant_id, scheduled_date, status)
    WHERE status != 'cancelled';

CREATE INDEX IF NOT EXISTS idx_appointments_status
    ON appointments(tenant_id, status)
    WHERE status IN ('pending', 'in_progress', 'done');

CREATE INDEX IF NOT EXISTS idx_appointments_vehicle
    ON appointments(vehicle_id, scheduled_date DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_customer
    ON appointments(customer_id, scheduled_date DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_assigned
    ON appointments(assigned_to, scheduled_date)
    WHERE status IN ('pending', 'in_progress');

-- ============================================================================
-- APPOINTMENT STATUS LOG
-- ============================================================================
CREATE TABLE IF NOT EXISTS appointment_status_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id  UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    previous_status VARCHAR(20),
    new_status      VARCHAR(20) NOT NULL,
    changed_by      UUID REFERENCES users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_log_appointment ON appointment_status_log(appointment_id);

-- ============================================================================
-- PAYMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS payments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    appointment_id  UUID NOT NULL REFERENCES appointments(id),
    amount          INTEGER NOT NULL,
    payment_method  VARCHAR(20) NOT NULL DEFAULT 'cash',
    invoice_id      VARCHAR(50),
    invoice_number  VARCHAR(30),
    invoice_cufe    VARCHAR(100),
    invoice_pdf_url TEXT,
    invoice_status  VARCHAR(20),
    received_by     UUID REFERENCES users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_date ON payments(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_appointment ON payments(appointment_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(tenant_id, invoice_status)
    WHERE invoice_id IS NOT NULL;

-- ============================================================================
-- WHATSAPP MESSAGES (Fase 3 - la tabla existe pero se usa después)
-- ============================================================================
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone           VARCHAR(20) NOT NULL,
    direction       VARCHAR(10) NOT NULL,
    message_type    VARCHAR(20) DEFAULT 'text',
    content         TEXT NOT NULL,
    flow_step       VARCHAR(50),
    external_id     VARCHAR(100),
    status          VARCHAR(20) DEFAULT 'sent',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_tenant_phone
    ON whatsapp_messages(tenant_id, phone, created_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ 
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY['tenants','users','customers','vehicles','services','appointments'])
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_%s_updated ON %s; CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION update_updated_at();',
            tbl, tbl, tbl, tbl
        );
    END LOOP;
END $$;

-- ============================================================================
-- MATERIALIZED VIEW (Fase 2 - Reportes)
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_summary AS
SELECT
    a.tenant_id,
    a.scheduled_date AS report_date,
    COUNT(*) AS total_appointments,
    COUNT(*) FILTER (WHERE a.status = 'delivered') AS completed,
    COUNT(*) FILTER (WHERE a.status = 'cancelled') AS cancelled,
    COALESCE(SUM(p.amount), 0) AS total_revenue,
    COUNT(DISTINCT a.customer_id) AS unique_customers,
    AVG(
        EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) / 60
    ) FILTER (WHERE a.completed_at IS NOT NULL AND a.started_at IS NOT NULL)
    AS avg_service_minutes
FROM appointments a
LEFT JOIN payments p ON p.appointment_id = a.id
GROUP BY a.tenant_id, a.scheduled_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_summary
    ON mv_daily_summary(tenant_id, report_date);
`;

async function migrate() {
  console.log('🔄 Ejecutando migración...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada exitosamente');
  } catch (err) {
    console.error('❌ Error en migración:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
