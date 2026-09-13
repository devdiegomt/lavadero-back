/**
 * Cuántos clientes hay sin autorización de tratamiento, y desde cuándo.
 *
 *     npm run db:consentimiento          # todos los lavaderos
 *     npm run db:consentimiento 12       # y qué pasaría anonimizando a los 12 meses
 *
 * ## Por qué existe
 *
 * La **brecha #6** de [Seguridad §7](../../../docs/05-seguridad.md) es *"clientes
 * sin autorización que no han vuelto"*, y está clasificada como *"decisión del
 * responsable"*. El problema es que la decisión no se podía tomar: **no había
 * forma de ver el número.**
 *
 * `clientesSinAutorizacion()` existía desde hacía meses, con pruebas, y no la
 * llamaba nadie fuera de las pruebas. Ninguna ruta, ningún script. O sea que
 * RF-DAT-5 —*"se puede contar cuántos clientes quedaron sin autorización"*— era
 * cierto sobre el código y falso sobre lo que alguien podía hacer.
 *
 * Decidir entre pedirles autorización, anonimizarlos o dejarlo correr cambia
 * entero según sean tres clientes o trescientos. Esto imprime el número.
 *
 * ## Qué NO hace
 *
 * **No modifica nada.** Es un informe. Anonimizar es una decisión con
 * consecuencias legales y la toma el responsable del tratamiento, no un script
 * que alguien corrió sin querer. Lo que sí hace es simular: con un plazo, dice
 * cuántos alcanzaría antes de que se active nada.
 */
import 'dotenv/config';
import { pool } from './index';
import { politicaRetencion } from './retencion';

interface FilaLavadero {
  tenant_id: string;
  nombre: string;
  total: string;
  sin_autorizacion: string;
  sin_autorizacion_inactivos: string;
  mas_viejo_meses: string | null;
}

/**
 * El corte de inactividad es el mismo que usa `anonimizarClientesInactivos`:
 * `COALESCE(last_visit_at, created_at)`. Si el informe midiera otra cosa, diría
 * un número y pasaría otro.
 */
async function informe(meses: number): Promise<void> {
  const cliente = await pool.connect();
  // Cruza todos los lavaderos a propósito: es un informe del responsable del
  // tratamiento, no de un tenant.
  await cliente.query(`SELECT set_config('app.bypass_rls', 'on', false)`);

  try {
    const { rows } = await cliente.query<FilaLavadero>(
      `SELECT t.id AS tenant_id,
              t.name AS nombre,
              count(*) FILTER (WHERE c.anonymized_at IS NULL AND c.deleted_at IS NULL) AS total,
              count(*) FILTER (
                WHERE c.consent_at IS NULL
                  AND c.anonymized_at IS NULL
                  AND c.deleted_at IS NULL
              ) AS sin_autorizacion,
              count(*) FILTER (
                WHERE c.consent_at IS NULL
                  AND c.anonymized_at IS NULL
                  AND c.deleted_at IS NULL
                  AND COALESCE(c.last_visit_at, c.created_at) < NOW() - ($1 || ' months')::interval
              ) AS sin_autorizacion_inactivos,
              max(
                EXTRACT(EPOCH FROM (NOW() - COALESCE(c.last_visit_at, c.created_at))) / 2629746
              ) FILTER (
                WHERE c.consent_at IS NULL AND c.anonymized_at IS NULL AND c.deleted_at IS NULL
              ) AS mas_viejo_meses
       FROM tenants t
       LEFT JOIN customers c ON c.tenant_id = t.id
       GROUP BY t.id, t.name
       ORDER BY t.name`,
      [String(meses)],
    );

    console.log('');
    console.log(`📋 Clientes sin autorización de tratamiento (Ley 1581)`);
    console.log(`   Inactivos = sin volver hace más de ${meses} meses.`);
    console.log('');
    console.log(
      '   Lavadero'.padEnd(34) +
        'Clientes'.padStart(10) +
        'Sin autoriz.'.padStart(14) +
        'De esos, inactivos'.padStart(20),
    );
    console.log('   ' + '─'.repeat(75));

    let totales = 0;
    let totalSin = 0;
    let totalInactivos = 0;

    for (const f of rows) {
      totales += Number(f.total);
      totalSin += Number(f.sin_autorizacion);
      totalInactivos += Number(f.sin_autorizacion_inactivos);

      console.log(
        '   ' +
          f.nombre.slice(0, 30).padEnd(31) +
          f.total.padStart(10) +
          f.sin_autorizacion.padStart(14) +
          f.sin_autorizacion_inactivos.padStart(20),
      );
    }

    console.log('   ' + '─'.repeat(75));
    console.log(
      '   ' +
        'TOTAL'.padEnd(31) +
        String(totales).padStart(10) +
        String(totalSin).padStart(14) +
        String(totalInactivos).padStart(20),
    );
    console.log('');

    const masViejo = rows
      .map((f) => (f.mas_viejo_meses ? Math.floor(Number(f.mas_viejo_meses)) : 0))
      .reduce((a, b) => Math.max(a, b), 0);

    if (totalSin === 0) {
      console.log('   ✅ No hay pasivo: todos los clientes vigentes tienen autorización.');
      console.log('      La brecha #6 no aplica.');
    } else {
      console.log(`   El más antiguo sin autorización lleva ~${masViejo} meses sin volver.`);
      console.log('');
      console.log('   Las tres salidas, y ninguna la decide este script:');
      console.log('');
      console.log('   1. Pedirles autorización. A los que vuelven ya se les pide sola');
      console.log('      (RF-WA-16); esto sería escribirle a los que no volvieron, que es');
      console.log('      usar sus datos para contactarlos sin tenerla.');
      console.log(`   2. Anonimizarlos: hoy alcanzaría a ${totalInactivos} de ${totalSin}.`);
      console.log('      Se activa poniendo DATA_RETENTION_CUSTOMERS_MONTHS y corre sola');
      console.log('      cada 24 h. Los turnos quedan como historial del negocio.');
      console.log('   3. Dejarlo correr como pasivo decreciente: cada cliente que vuelve');
      console.log('      sale de la lista.');
    }

    console.log('');
    console.log(
      `   Política vigente: ${
        politicaRetencion.mesesClientes
          ? `anonimizar a los ${politicaRetencion.mesesClientes} meses`
          : 'SIN anonimización automática (DATA_RETENTION_CUSTOMERS_MONTHS=0)'
      }`,
    );
    console.log('');
    console.log('   Este informe no modificó nada.');
    console.log('');
  } finally {
    cliente.release();
    await pool.end();
  }
}

const arg = process.argv[2];
const meses = arg ? Number(arg) : politicaRetencion.mesesClientes || 24;

if (!Number.isFinite(meses) || meses <= 0) {
  console.error(`❌ Plazo inválido: ${arg}. Se espera un número de meses mayor que cero.`);
  process.exit(1);
}

void informe(meses);
