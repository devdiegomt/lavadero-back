/**
 * Migración: días de apertura y ventana de reserva.
 * Ejecutar: npm run db:migrate-agenda
 *
 * `tenants` sabía a qué hora abre y cierra, pero no **qué días**. Sin eso, la
 * regla «no abrimos domingos» no tenía dónde vivir y habría acabado escrita
 * fija en el código — falso en cuanto un lavadero abra domingo y cierre lunes,
 * que en Colombia es común.
 *
 * Los valores por defecto son los de un lavadero típico: cerrado los domingos,
 * y hasta una semana de anticipación para reservar.
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
-- ============================================================================
-- TENANTS: días de apertura y ventana de reserva
-- ============================================================================

-- Días de la semana en que NO se atiende, con la numeración de PostgreSQL y de
-- JavaScript: 0 = domingo … 6 = sábado. Coinciden, así que no hay conversión
-- que equivocar entre la consulta y el código.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS closed_weekdays SMALLINT[] DEFAULT '{0}';

-- Cuántos días hacia adelante se puede reservar, contando hoy.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_days_ahead SMALLINT DEFAULT 7;

COMMENT ON COLUMN tenants.closed_weekdays IS
  'Días sin atención. 0=domingo … 6=sábado, igual que EXTRACT(DOW) y Date.getDay().';
COMMENT ON COLUMN tenants.booking_days_ahead IS
  'Ventana de reserva en días, contando hoy. 7 = de hoy a los próximos seis días abiertos.';

-- Una ventana de 0 o negativa dejaría al lavadero sin poder agendar nada, y el
-- síntoma seria un menu vacio sin explicacion. Mejor que no se pueda guardar.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS chk_tenants_booking_window;
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_booking_window
  CHECK (booking_days_ahead IS NULL OR booking_days_ahead BETWEEN 1 AND 90);
`;

async function migrate(): Promise<void> {
  console.log('🔄 Ejecutando migración de agenda...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 tenants.closed_weekdays (por defecto: domingos)');
    console.log('   📋 tenants.booking_days_ahead (por defecto: 7 días)');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
