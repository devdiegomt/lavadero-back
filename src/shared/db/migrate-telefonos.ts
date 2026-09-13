/**
 * Migración: llevar los teléfonos ya guardados a su forma canónica.
 * Ejecutar: npm run db:migrate-telefonos
 *
 * La otra mitad del arreglo vive en el código (`utils/telefono.ts`), que canoniza
 * todo lo que entra de ahora en adelante. Esta migración se ocupa de lo que ya
 * está escrito: sin ella, un cliente cargado como `3223772019` sigue sin
 * enlazarse con el `+573223772019` que manda bot-wa.
 *
 * No es SQL puro a propósito: la regla de qué se puede canonizar y qué no
 * —cuándo poner `+57` y cuándo quedarse quieto— ya está escrita y probada en
 * TypeScript, y tenerla dos veces es tenerla mal una de las dos.
 *
 * Usa `queryAdmin`, que saltea RLS: recorre las filas de **todos** los tenants.
 * Con `query()` a secas y RLS activo no vería ninguna y terminaría informando
 * "0 teléfonos reescritos" sin un solo error — una migración que dice que hizo
 * su trabajo y no hizo nada.
 *
 * ## Lo que NO hace: fusionar duplicados
 *
 * Al normalizar, dos filas que eran "distintas" pasan a tener el mismo
 * teléfono. **Esta migración las deja quietas y las reporta.** Fusionarlas
 * significa decidir qué nombre gana, qué documento gana y —lo que de verdad
 * importa— qué fecha de autorización se conserva, y eso es decisión del
 * responsable del tratamiento, no de un script que corre sin nadie mirando.
 */
import 'dotenv/config';
import { pool, queryAdmin } from './index';
import { normalizarTelefono } from '../utils/telefono';

/** Tablas y columnas con teléfono. El orden no importa; se hacen todas. */
export const COLUMNAS: ReadonlyArray<{ tabla: string; columna: string }> = [
  { tabla: 'customers', columna: 'phone' },
  { tabla: 'whatsapp_messages', columna: 'phone' },
  { tabla: 'tenants', columna: 'whatsapp_phone' },
  { tabla: 'tenants', columna: 'phone' },
  { tabla: 'users', columna: 'phone' },
];

/** De a tantas filas por vuelta: `whatsapp_messages` puede ser grande. */
const LOTE = 500;

export async function normalizarColumna(tabla: string, columna: string): Promise<number> {
  let cambiadas = 0;
  let desde = '';

  // Se pagina por id para no traerse la tabla entera a memoria ni depender de
  // un OFFSET que se corre a medida que las filas cambian.
  for (;;) {
    const { rows } = await queryAdmin<{ id: string; valor: string }>(
      `SELECT id, ${columna} AS valor FROM ${tabla}
       WHERE ${columna} IS NOT NULL AND id::text > $1
       ORDER BY id::text
       LIMIT ${LOTE}`,
      [desde],
    );
    if (rows.length === 0) break;
    desde = rows[rows.length - 1].id;

    for (const fila of rows) {
      const canonico = normalizarTelefono(fila.valor);
      if (canonico === null || canonico === fila.valor) continue;

      // VARCHAR(20): si la forma canónica no cupiera, se deja la original. No
      // ha pasado, pero fallar la migración entera por una fila rara sería
      // peor que dejar esa fila como estaba.
      if (canonico.length > 20) {
        console.warn(`   ⚠️  ${tabla}.${columna} ${fila.id}: "${canonico}" excede 20 chars, se deja igual`);
        continue;
      }

      await queryAdmin(`UPDATE ${tabla} SET ${columna} = $1 WHERE id = $2`, [canonico, fila.id]);
      cambiadas++;
    }
  }

  return cambiadas;
}

export interface Duplicado {
  tenant_id: string;
  phone: string;
  cuantos: number;
  ids: string[];
  nombres: string[];
}

/**
 * Clientes que quedaron compartiendo teléfono. Son los que había que encontrar:
 * casi siempre es la misma persona cargada dos veces.
 */
export async function buscarDuplicados(): Promise<Duplicado[]> {
  const { rows } = await queryAdmin<Duplicado>(
    `SELECT tenant_id,
            phone,
            count(*)::int                                   AS cuantos,
            array_agg(id::text ORDER BY created_at)          AS ids,
            array_agg(
              trim(first_name || ' ' || coalesce(last_name, ''))
              ORDER BY created_at
            )                                               AS nombres
     FROM customers
     WHERE phone IS NOT NULL AND deleted_at IS NULL AND anonymized_at IS NULL
     GROUP BY tenant_id, phone
     HAVING count(*) > 1
     ORDER BY count(*) DESC`,
  );
  return rows;
}

async function migrate(): Promise<void> {
  console.log('🔄 Normalizando teléfonos a forma canónica (+57…)...');
  try {
    let total = 0;
    for (const { tabla, columna } of COLUMNAS) {
      const cambiadas = await normalizarColumna(tabla, columna);
      total += cambiadas;
      console.log(`   📋 ${tabla}.${columna}: ${cambiadas} ${cambiadas === 1 ? 'fila' : 'filas'}`);
    }

    console.log(
      total === 1
        ? '✅ Migración completada — 1 teléfono reescrito'
        : `✅ Migración completada — ${total} teléfonos reescritos`,
    );

    const duplicados = await buscarDuplicados();
    if (duplicados.length === 0) {
      console.log('   Sin clientes que compartan teléfono.');
      return;
    }

    console.log('');
    console.log(`⚠️  ${duplicados.length} ${duplicados.length === 1 ? 'teléfono' : 'teléfonos'} con más de un cliente.`);
    console.log('   Muy probablemente sea la misma persona cargada dos veces: una desde');
    console.log('   el panel y otra al escribir por WhatsApp. NO se fusionaron — decidir');
    console.log('   qué nombre y qué fecha de autorización se conservan es del responsable');
    console.log('   del tratamiento, no de este script.');
    console.log('');
    for (const d of duplicados) {
      console.log(`   ${d.phone} → ${d.cuantos} clientes: ${d.nombres.join(' | ')}`);
      console.log(`      ids: ${d.ids.join(', ')}`);
    }
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Sólo al ejecutarla como script. Las funciones de arriba se importan desde las
// pruebas, y ahí no se quiere que corra sola ni que cierre el pool.
if (require.main === module) migrate();
