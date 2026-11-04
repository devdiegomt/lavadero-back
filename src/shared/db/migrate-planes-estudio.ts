/**
 * Migración: planes Estudio y Estudio Pro, y el estado de la suscripción.
 * Ejecutar: npm run db:migrate-planes
 *
 * Qlarity pasa a venderse a lavaderos exclusivos y de detailing (ver la hoja
 * de ruta). Para ellos los planes por volumen —Gratis, Básico y Pro, con tope de
 * turnos al mes— no tienen sentido: hacen pocos carros al día y cada uno vale
 * mucho. Quedan dos planes, sin plan gratis:
 *
 * | Plan        | Precio       | Operarios | Turnos/mes | Facturación | WhatsApp |
 * |-------------|--------------|-----------|------------|-------------|----------|
 * | Estudio     | $149.000/mes | 4         | sin límite | no          | no       |
 * | Estudio Pro | $249.000/mes | sin límite| sin límite | sí          | sí       |
 *
 * ## «Sin límite» es NULL
 *
 * Antes cada límite era un número obligatorio, y «sin límite» habría sido un
 * número grande inventado. Ahora un límite NULL es sin límite, y el código lo
 * trata así (planLimits.ts).
 *
 * ## Los planes viejos no se borran
 *
 * Quedan con `is_active = false`: no se ofrecen más, pero quien esté en uno
 * sigue con sus límites. Esto exigió un arreglo en planLimits.ts, que sólo
 * leía planes activos y a un lavadero con un plan desactivado lo dejaba pasar
 * sin ningún límite.
 *
 * ## Estado de la suscripción
 *
 * `subscription_status`:
 *   - `trial`     — en prueba hasta `trial_ends_at`. Al vencer, sólo lectura.
 *   - `active`    — pagando (por ahora lo marca el superadmin a mano).
 *   - `suspended` — sólo lectura, aunque la fecha no haya vencido.
 *
 * **Los lavaderos que ya existían quedan `active`**, no `trial`: venían
 * usando el sistema y no pueden amanecer en sólo lectura por una migración.
 *
 * `discount_pct` y `discount_until` guardan el precio fundador (30% el primer
 * año para los primeros lavaderos). Hoy sólo se muestran; cuando haya cobro
 * con tarjeta, es lo que la pasarela va a leer.
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
-- Límites que pueden ser «sin límite»
ALTER TABLE plans ALTER COLUMN max_operators DROP NOT NULL;
ALTER TABLE plans ALTER COLUMN max_appointments_month DROP NOT NULL;
ALTER TABLE plans ALTER COLUMN max_services DROP NOT NULL;
ALTER TABLE plans ALTER COLUMN max_bays DROP NOT NULL;

COMMENT ON COLUMN plans.max_appointments_month IS 'NULL = sin límite.';

-- Los dos planes nuevos. DO NOTHING: si el superadmin ya les cambió el precio
-- o un límite, correr la migración otra vez no se lo pisa.
INSERT INTO plans (id, name, price_monthly, max_operators, max_appointments_month, max_services, max_bays,
                   whatsapp_enabled, billing_enabled, reports_enabled, is_active, sort_order)
VALUES
  ('estudio',     'Estudio',     14900000, 4,    NULL, 30,   4,    false, false, true, true, 10),
  ('estudio_pro', 'Estudio Pro', 24900000, NULL, NULL, NULL, NULL, true,  true,  true, true, 11)
ON CONFLICT (id) DO NOTHING;

-- Los de volumen dejan de ofrecerse; quien los tenga, los conserva.
UPDATE plans SET is_active = false WHERE id IN ('free', 'basic', 'pro');

-- Estado de la suscripción. Los que ya existían quedan activos: el valor por
-- omisión se pone en 'active' para ellos y recién después pasa a 'trial',
-- que es lo que corresponde a un lavadero nuevo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'tenants' AND column_name = 'subscription_status') THEN
    ALTER TABLE tenants ADD COLUMN subscription_status VARCHAR(12) NOT NULL DEFAULT 'active';
    ALTER TABLE tenants ALTER COLUMN subscription_status SET DEFAULT 'trial';
    ALTER TABLE tenants ADD CONSTRAINT chk_tenants_subscription_status
      CHECK (subscription_status IN ('trial', 'active', 'suspended'));
  END IF;
END $$;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS discount_pct SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS discount_until DATE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tenants_discount_pct') THEN
    ALTER TABLE tenants ADD CONSTRAINT chk_tenants_discount_pct CHECK (discount_pct BETWEEN 0 AND 100);
  END IF;
END $$;

COMMENT ON COLUMN tenants.subscription_status IS
  'trial: en prueba hasta trial_ends_at; al vencer, sólo lectura. active: pagando. suspended: sólo lectura.';
COMMENT ON COLUMN tenants.discount_pct IS
  'Descuento sobre el precio del plan (precio fundador). Vale hasta discount_until; sin fecha, sin vencimiento.';
`;

async function migrate(): Promise<void> {
  console.log('🔄 Planes Estudio y Estudio Pro, y estado de la suscripción...');
  try {
    await pool.query(migration);
    const { rows } = await pool.query<{ id: string; name: string; is_active: boolean }>(
      'SELECT id, name, is_active FROM plans ORDER BY sort_order',
    );
    console.log('✅ Migración completada');
    for (const p of rows) console.log(`   ${p.is_active ? '●' : '○'} ${p.name} (${p.id})${p.is_active ? '' : ' — ya no se ofrece'}`);
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void migrate();
