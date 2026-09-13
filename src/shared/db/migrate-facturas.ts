/**
 * Migración: archivo propio de las facturas emitidas.
 * Ejecutar: npm run db:migrate-facturas
 *
 * La DIAN obliga a conservar las facturas **cinco años**. Hasta ahora sólo se
 * guardaba la *referencia*: el número, el CUFE y una **URL** al PDF que vive en
 * Alegra. Eso no es conservar nada — si la cuenta se vence, si el proveedor
 * cambia de política o simplemente pierde el archivo, el lavadero se queda sin
 * los documentos que la ley le exige tener. Una URL no es una copia.
 *
 * ## Qué se guarda
 *
 * | Artefacto | Por qué |
 * |---|---|
 * | **El PDF** | Es la representación gráfica que el cliente recibió |
 * | **El JSON de Alegra** | Es el registro completo: ítems, importes, impuestos, el CUFE y el estado ante la DIAN. Si el PDF se corrompe, de acá se reconstruye qué se facturó |
 *
 * **Lo que NO se guarda es el XML firmado**, que es el documento legalmente
 * autoritativo. El cliente de Alegra de este proyecto no expone un método para
 * pedirlo, y no se va a inventar un endpoint a ciegas. Queda anotado como lo que
 * falta en [ADR-0009](../../../docs/adr/0009-archivo-de-facturas.md); mientras
 * tanto esto ya elimina el punto único de fallo.
 *
 * ## Por qué en PostgreSQL y no en un bucket
 *
 * Porque el respaldo de la base ya existe y una obligación de cinco años quiere
 * **una** cosa que respaldar, no dos que se desincronizan. Un lavadero factura
 * del orden de 5.000 documentos al año; a ~100 KB por PDF son unos 2,5 GB en el
 * plazo completo, que PostgreSQL maneja sin drama con TOAST comprimiendo.
 *
 * El techo está anotado: si esto creciera a decenas de lavaderos, el lugar pasa
 * a ser almacenamiento de objetos. Ver el ADR.
 *
 * ## El hash no es decoración
 *
 * `sha256` se guarda con cada documento porque **una copia que no se puede
 * verificar no es una copia**. Sin él, un byte corrupto en un respaldo de hace
 * tres años se descubre el día que la DIAN pide el documento.
 */
import 'dotenv/config';
import { pool } from './index';

const migration = `
-- ============================================================================
-- INVOICE_ARCHIVE: la copia propia de cada factura emitida
-- ============================================================================

CREATE TABLE IF NOT EXISTS invoice_archive (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- RESTRICT y no CASCADE: borrar un pago no puede llevarse la factura. La
    -- obligación de conservarla es de la DIAN y no depende de lo que pase con
    -- el registro interno del pago.
    payment_id      UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,

    invoice_id      VARCHAR(100) NOT NULL,
    invoice_number  VARCHAR(50),
    cufe            VARCHAR(200),

    -- El plazo de cinco años corre desde la emisión, no desde que se archivó.
    issued_at       TIMESTAMPTZ,

    kind            VARCHAR(10) NOT NULL,
    content         BYTEA NOT NULL,
    content_type    VARCHAR(100),
    bytes           INTEGER NOT NULL,
    sha256          CHAR(64) NOT NULL,

    archived_at     TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT chk_invoice_archive_kind CHECK (kind IN ('pdf', 'json', 'xml'))
);

COMMENT ON TABLE invoice_archive IS
  'Copia propia de las facturas emitidas. La DIAN obliga a conservarlas 5 años y antes sólo se guardaba una URL a Alegra. Ver migrate-facturas.ts.';
COMMENT ON COLUMN invoice_archive.sha256 IS
  'Hash del contenido. Una copia que no se puede verificar no es una copia.';
COMMENT ON COLUMN invoice_archive.issued_at IS
  'Fecha de emisión: el plazo de conservación corre desde acá, no desde archived_at.';

-- Un artefacto de cada tipo por pago. Reintentar el archivado no duplica.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_archive_pago_tipo
    ON invoice_archive(payment_id, kind);

-- "Dame las facturas de este lavadero en este rango": la consulta de una
-- inspección, y la del reporte anual.
CREATE INDEX IF NOT EXISTS idx_invoice_archive_tenant_fecha
    ON invoice_archive(tenant_id, issued_at DESC);

-- Buscar por número o por CUFE es como llega un requerimiento de la DIAN.
CREATE INDEX IF NOT EXISTS idx_invoice_archive_numero
    ON invoice_archive(tenant_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoice_archive_cufe
    ON invoice_archive(cufe) WHERE cufe IS NOT NULL;
`;

async function migrate(): Promise<void> {
  console.log('🔄 Creando el archivo de facturas...');
  try {
    await pool.query(migration);
    console.log('✅ Migración completada');
    console.log('   📋 invoice_archive (+3 índices)');
    console.log('');
    console.log('   Las facturas ya emitidas no se archivan solas:');
    console.log('     npm run db:archivar-facturas');
    console.log('   Y correr después db:migrate-rls, que descubre la tabla nueva.');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) migrate();
