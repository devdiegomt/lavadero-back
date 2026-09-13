/**
 * Comprueba que las facturas archivadas sigan siendo las que se archivaron.
 * Ejecutar: npm run db:verificar-facturas
 *
 * Cada documento se guardó con su SHA-256 porque **una copia que no se puede
 * verificar no es una copia**. Esto es lo que hace uso de ese hash: recorre el
 * archivo y recalcula.
 *
 * La corrupción silenciosa de un respaldo no avisa. Descubrirla el día que la
 * DIAN pide el documento es tarde; descubrirla en una corrida trimestral todavía
 * deja tiempo de volver a bajar la factura de Alegra.
 *
 * Va con la puerta de atrás de RLS porque recorre **todos** los lavaderos, como
 * cualquier tarea de mantenimiento. Ver `shared/middleware/rls.ts`.
 */
import 'dotenv/config';
import { pool } from './index';
import { conBypassRlsFueraDePeticion } from '../middleware/rls';
import { verificarIntegridad } from '../../modules/billing/archivo';

async function main(): Promise<void> {
  console.log('🔄 Verificando la integridad del archivo de facturas...');

  try {
    const estado = await conBypassRlsFueraDePeticion(() => verificarIntegridad());

    if (estado.total === 0) {
      console.log('   No hay facturas archivadas todavía.');
      console.log('   Si ya se emitieron facturas: npm run db:archivar-facturas');
      return;
    }

    if (estado.corruptos.length === 0) {
      console.log(`✅ ${estado.total} documentos verificados, todos íntegros`);
      return;
    }

    console.error('');
    console.error(
      `❌ ${estado.corruptos.length} de ${estado.total} documentos NO coinciden con su hash:`,
    );
    for (const c of estado.corruptos) {
      console.error(`   ${c.invoice_number ?? '(sin número)'} · ${c.kind} · pago ${c.payment_id}`);
    }
    console.error('');
    console.error('   Esos documentos están corruptos y el sistema se niega a entregarlos como');
    console.error('   auténticos. Volver a bajarlos mientras la cuenta de Alegra siga vigente:');
    console.error('     npm run db:archivar-facturas');
    // Sale distinto de cero para que, si esto corre desde un cron o un CI, el
    // fallo se note en vez de quedarse en una línea de log que nadie lee.
    process.exit(1);
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) void main();
