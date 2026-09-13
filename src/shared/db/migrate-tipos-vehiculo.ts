/**
 * Migración: cerrar `vehicles.vehicle_type` al conjunto que el precio conoce.
 * Ejecutar: npm run db:migrate-tipos-vehiculo
 *
 * La columna era un `VARCHAR(20)` sin restricción, y el `PATCH` del panel no
 * validaba: se podía guardar `vehicle_type = 'submarino'`. Comprobado.
 *
 * No queda en un valor raro y visible, que sería lo de menos. `getServicePrice`
 * busca la columna `price_<tipo>` y, **cuando el tipo no está en el mapa, cae a
 * `price_sedan`**. Así que una camioneta mal tipeada se cobra como sedán, sin un
 * error, sin un aviso, y la diferencia la pierde el lavadero en cada lavado.
 *
 * El borde ya se cerró con Zod (`schemas.vehicleUpdate`). Esto es la otra mitad:
 * de este campo depende cuánta plata se cobra, y un invariante de plata no
 * debería apoyarse en que todas las rutas —las de hoy y las de mañana— se
 * acuerden de validar.
 *
 * ## Por qué `NOT VALID`
 *
 * Se agrega con `NOT VALID`: PostgreSQL la aplica a todo lo que se escriba de
 * ahora en adelante, pero **no verifica las filas que ya están**. Es deliberado.
 * Si alguna base tiene tipos inválidos, una restricción normal haría fallar la
 * migración entera y el despliegue con ella; así se cierra la puerta de una vez
 * y las filas viejas quedan **listadas** para que alguien decida qué son.
 *
 * Corregirlas a mano no es algo que un script pueda adivinar: un `'submarino'`
 * puede haber sido una camioneta o una moto, y elegir mal cambia lo que se
 * cobra. Cuando estén arregladas, validar la restricción es una línea:
 *
 *   ALTER TABLE vehicles VALIDATE CONSTRAINT chk_vehicles_tipo;
 */
import 'dotenv/config';
import { pool, queryAdmin } from './index';

const TIPOS = ['sedan', 'suv', 'camioneta', 'moto', 'pickup'] as const;

const migration = `
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS chk_vehicles_tipo;
ALTER TABLE vehicles ADD CONSTRAINT chk_vehicles_tipo
  CHECK (vehicle_type IS NULL OR vehicle_type IN (${TIPOS.map((t) => `'${t}'`).join(', ')}))
  NOT VALID;

COMMENT ON COLUMN vehicles.vehicle_type IS
  'Uno de: sedan, suv, camioneta, moto, pickup. De esto depende qué columna price_* se cobra: un tipo fuera de la lista hace que getServicePrice caiga a price_sedan.';
`;

async function migrate(): Promise<void> {
  console.log('🔄 Cerrando vehicles.vehicle_type a los tipos con precio...');
  try {
    await pool.query(migration);
    console.log('✅ Restricción chk_vehicles_tipo agregada (NOT VALID)');

    const { rows } = await queryAdmin<{
      id: string;
      plate: string;
      vehicle_type: string;
      tenant: string;
    }>(
      `SELECT v.id::text, v.plate, v.vehicle_type, t.name AS tenant
       FROM vehicles v JOIN tenants t ON t.id = v.tenant_id
       WHERE v.vehicle_type IS NOT NULL
         AND v.vehicle_type NOT IN (${TIPOS.map((_, i) => `$${i + 1}`).join(', ')})
       ORDER BY t.name, v.plate`,
      [...TIPOS],
    );

    if (rows.length === 0) {
      console.log('   Ningún vehículo con un tipo fuera de la lista.');
      console.log('   Se puede validar del todo con:');
      console.log('     ALTER TABLE vehicles VALIDATE CONSTRAINT chk_vehicles_tipo;');
      return;
    }

    console.log('');
    console.log(`⚠️  ${rows.length} ${rows.length === 1 ? 'vehículo' : 'vehículos'} con un tipo que no tiene precio.`);
    console.log('   A estos se les está cobrando la tarifa de sedán sin que nada lo diga.');
    console.log('   NO se tocaron: adivinar si un tipo raro era camioneta o moto cambia');
    console.log('   lo que se cobra, y eso lo decide el lavadero.');
    console.log('');
    for (const v of rows) {
      console.log(`   ${v.tenant} · placa ${v.plate} · tipo "${v.vehicle_type}" · id ${v.id}`);
    }
    console.log('');
    console.log('   Una vez corregidos:');
    console.log('     ALTER TABLE vehicles VALIDATE CONSTRAINT chk_vehicles_tipo;');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) migrate();
