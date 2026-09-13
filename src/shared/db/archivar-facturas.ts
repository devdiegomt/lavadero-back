/**
 * Archiva las facturas que se emitieron antes de que el archivo existiera, y
 * reintenta las que quedaron sin copia.
 * Ejecutar: npm run db:archivar-facturas
 *
 * El archivado automático corre al emitir. Este script cubre los dos casos que
 * ese camino no alcanza:
 *
 * 1. **Lo emitido antes.** Toda factura anterior a esta migración existe sólo en
 *    Alegra. Ese es el pasivo que la obligación de la DIAN vuelve urgente.
 * 2. **Lo que falló.** El archivado nunca hace fallar una emisión, así que una
 *    caída de red deja la factura emitida y sin copia. Acá se recupera.
 *
 * Es idempotente: lo ya archivado se salta.
 *
 * ## Por qué va con la puerta de atrás de RLS
 *
 * Recorre las facturas de **todos** los lavaderos, como cualquier tarea de
 * mantenimiento. Que tenga que pedirlo explícitamente es lo que hace visible que
 * cruza tenants. Ver `shared/middleware/rls.ts`.
 */
import 'dotenv/config';
import { pool, queryAdmin } from './index';
import { conBypassRlsFueraDePeticion } from '../middleware/rls';
import { archivarFactura } from '../../modules/billing/archivo';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createAlegraClientForTenant } = require('../../modules/billing/alegra.client') as {
  createAlegraClientForTenant(tenant: unknown): {
    getInvoice(id: string): Promise<{ id: string; pdf?: string; date?: string }>;
  } | null;
};

interface PendienteRow {
  payment_id: string;
  tenant_id: string;
  invoice_id: string;
  invoice_number: string | null;
  invoice_cufe: string | null;
  invoice_pdf_url: string | null;
  created_at: Date;
}

async function main(): Promise<void> {
  console.log('🔄 Buscando facturas sin copia propia...');

  try {
    await conBypassRlsFueraDePeticion(async () => {
      // Las que tienen factura emitida y no tienen PDF archivado. Se mira el PDF
      // y no el JSON porque el PDF es el que se puede perder al descargarlo: si
      // falta, hay trabajo que hacer aunque el JSON esté.
      const { rows: pendientes } = await queryAdmin<PendienteRow>(
        `SELECT p.id AS payment_id, p.tenant_id, p.invoice_id, p.invoice_number,
                p.invoice_cufe, p.invoice_pdf_url, p.created_at
         FROM payments p
         WHERE p.invoice_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM invoice_archive a
             WHERE a.payment_id = p.id AND a.kind = 'pdf'
           )
         ORDER BY p.created_at`,
      );

      if (pendientes.length === 0) {
        console.log('✅ Todas las facturas emitidas tienen su copia.');
        return;
      }

      console.log(`   ${pendientes.length} factura(s) sin copia. Recuperando...`);

      // Los tenants se cargan una vez: cada uno tiene su propia credencial de
      // Alegra y hay que hablarle con la suya.
      const tenants = new Map<string, unknown>();
      let archivadas = 0;
      const fallidas: { numero: string | null; motivo: string }[] = [];

      for (const p of pendientes) {
        try {
          if (!tenants.has(p.tenant_id)) {
            const { rows } = await queryAdmin(`SELECT * FROM tenants WHERE id = $1`, [p.tenant_id]);
            tenants.set(p.tenant_id, rows[0]);
          }
          const tenant = tenants.get(p.tenant_id);

          const alegra = createAlegraClientForTenant(tenant);
          if (!alegra) {
            fallidas.push({
              numero: p.invoice_number,
              motivo: 'el lavadero no tiene facturación configurada',
            });
            continue;
          }

          // Se vuelve a pedir la factura en vez de usar lo guardado: la URL del
          // PDF puede haber caducado, y el estado ante la DIAN pudo cambiar
          // desde que se emitió.
          const factura = await alegra.getInvoice(p.invoice_id);

          const res = await archivarFactura(
            {
              tenantId: p.tenant_id,
              paymentId: p.payment_id,
              invoiceId: p.invoice_id,
              invoiceNumber: p.invoice_number,
              cufe: p.invoice_cufe,
              issuedAt: factura.date ?? p.created_at,
            },
            factura,
            factura.pdf ?? p.invoice_pdf_url,
          );

          if (res.pdf) {
            archivadas++;
            console.log(`   ✔ ${p.invoice_number ?? p.invoice_id}`);
          } else {
            fallidas.push({
              numero: p.invoice_number,
              motivo: res.motivo ?? 'no se pudo descargar el PDF',
            });
          }
        } catch (err) {
          fallidas.push({ numero: p.invoice_number, motivo: (err as Error).message });
        }
      }

      console.log('');
      console.log(`✅ ${archivadas} de ${pendientes.length} archivadas`);

      if (fallidas.length > 0) {
        console.log('');
        console.log(`⚠️  ${fallidas.length} sin copia todavía:`);
        for (const f of fallidas) console.log(`   ${f.numero ?? '(sin número)'} — ${f.motivo}`);
        console.log('');
        console.log('   Estas facturas sólo existen en Alegra. Volver a intentar, y si');
        console.log('   persiste, bajarlas a mano desde el panel de Alegra antes de que');
        console.log('   la cuenta caduque.');
      }
    });
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) void main();
