/**
 * La copia propia de cada factura emitida.
 *
 * Antes sólo se guardaba la referencia —número, CUFE y una **URL** al PDF de
 * Alegra—. Eso no cumple la obligación de la DIAN de conservar cinco años: si la
 * cuenta se vence o el proveedor pierde el archivo, el lavadero se queda sin los
 * documentos que la ley le exige tener. Una URL no es una copia.
 *
 * Ver `shared/db/migrate-facturas.ts` para el esquema y el porqué de guardarlo
 * en PostgreSQL, y [ADR-0009](../../../docs/adr/0009-archivo-de-facturas.md)
 * para la decisión completa.
 */
import crypto from 'crypto';
import * as db from '../../shared/db';
import logger from '../../shared/utils/logger';

/** Tope por documento. Un PDF de factura pesa ~100 KB; 10 MB es disparatado. */
const MAXIMO_BYTES = 10 * 1024 * 1024;

/** Corte de la descarga. Archivar no puede colgar la emisión de una factura. */
const TIMEOUT_MS = parseInt(process.env.ARCHIVO_TIMEOUT_MS || '20000', 10);

export type TipoArtefacto = 'pdf' | 'json' | 'xml';

export interface DatosFactura {
  tenantId: string;
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  cufe: string | null;
  issuedAt: Date | string | null;
}

function hash(contenido: Buffer): string {
  return crypto.createHash('sha256').update(contenido).digest('hex');
}

/**
 * Guarda un artefacto. Si ya estaba, lo reemplaza.
 *
 * El reemplazo es deliberado: reintentar el archivado de una factura cuyo PDF
 * Alegra regeneró tiene que dejar el vigente, no fallar por duplicado ni
 * conservar el viejo.
 */
export async function guardarArtefacto(
  datos: DatosFactura,
  kind: TipoArtefacto,
  contenido: Buffer,
  contentType: string,
): Promise<void> {
  if (contenido.length === 0) throw new Error(`El ${kind} de la factura vino vacío`);
  if (contenido.length > MAXIMO_BYTES) {
    throw new Error(`El ${kind} pesa ${contenido.length} bytes, más del máximo de ${MAXIMO_BYTES}`);
  }

  await db.query(
    `INSERT INTO invoice_archive
       (tenant_id, payment_id, invoice_id, invoice_number, cufe, issued_at,
        kind, content, content_type, bytes, sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (payment_id, kind) DO UPDATE SET
       content = EXCLUDED.content,
       content_type = EXCLUDED.content_type,
       bytes = EXCLUDED.bytes,
       sha256 = EXCLUDED.sha256,
       invoice_number = EXCLUDED.invoice_number,
       cufe = EXCLUDED.cufe,
       issued_at = EXCLUDED.issued_at,
       archived_at = NOW()`,
    [
      datos.tenantId,
      datos.paymentId,
      datos.invoiceId,
      datos.invoiceNumber,
      datos.cufe,
      datos.issuedAt ? new Date(datos.issuedAt) : null,
      kind,
      contenido as unknown as string,
      contentType,
      contenido.length,
      hash(contenido),
    ],
  );
}

/**
 * Descarga el PDF desde la URL que devolvió Alegra.
 *
 * Devuelve `null` si no se pudo, en vez de lanzar: el archivado es importante
 * pero **no puede impedir que se emita una factura**. Lo que no se pudo guardar
 * queda para `archivar-facturas`, que reintenta.
 */
async function descargarPdf(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, 'No se pudo descargar el PDF de la factura');
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());

    // Un HTML de error o una redirección a un login pesan poco y no son un PDF.
    // Guardarlos daría por archivado algo que no sirve — peor que no tener nada,
    // porque nadie vuelve a mirar.
    if (buf.length < 100 || buf.subarray(0, 4).toString('latin1') !== '%PDF') {
      logger.warn(
        { url, bytes: buf.length, inicio: buf.subarray(0, 20).toString('latin1') },
        'Lo descargado no es un PDF; no se archiva',
      );
      return null;
    }
    return buf;
  } catch (err) {
    logger.warn({ err: (err as Error).message, url }, 'Falló la descarga del PDF de la factura');
    return null;
  }
}

export interface ResultadoArchivado {
  json: boolean;
  pdf: boolean;
  motivo?: string;
}

/**
 * Archiva lo que se pueda de una factura recién emitida.
 *
 * **Nunca lanza.** Se llama después de emitir, y una factura emitida con la
 * copia pendiente es un problema mucho menor que una emisión que falla por no
 * poder guardar la copia. Lo que quede sin archivar se recupera con
 * `npm run db:archivar-facturas`.
 */
export async function archivarFactura(
  datos: DatosFactura,
  facturaDeAlegra: unknown,
  pdfUrl: string | null,
): Promise<ResultadoArchivado> {
  const resultado: ResultadoArchivado = { json: false, pdf: false };

  try {
    // El JSON primero: es lo que siempre se tiene, y con él se sabe qué se
    // facturó aunque el PDF no se haya podido bajar.
    const json = Buffer.from(JSON.stringify(facturaDeAlegra, null, 2), 'utf8');
    await guardarArtefacto(datos, 'json', json, 'application/json');
    resultado.json = true;
  } catch (err) {
    resultado.motivo = (err as Error).message;
    logger.error(
      { err: (err as Error).message, paymentId: datos.paymentId },
      'No se pudo archivar el JSON de la factura',
    );
  }

  if (pdfUrl) {
    const pdf = await descargarPdf(pdfUrl);
    if (pdf) {
      try {
        await guardarArtefacto(datos, 'pdf', pdf, 'application/pdf');
        resultado.pdf = true;
      } catch (err) {
        resultado.motivo = (err as Error).message;
        logger.error(
          { err: (err as Error).message, paymentId: datos.paymentId },
          'No se pudo archivar el PDF de la factura',
        );
      }
    }
  }

  if (!resultado.pdf) {
    // Queda dicho en el log: una factura sin copia propia es exactamente lo que
    // esto vino a evitar, y se recupera reintentando.
    logger.warn(
      { paymentId: datos.paymentId, invoiceId: datos.invoiceId },
      'Factura emitida sin copia del PDF. Reintentar con: npm run db:archivar-facturas',
    );
  }

  return resultado;
}

export interface ArtefactoGuardado {
  kind: TipoArtefacto;
  content: Buffer;
  content_type: string | null;
  bytes: number;
  sha256: string;
  invoice_number: string | null;
  archived_at: Date;
}

/** Lee un artefacto archivado, verificando que no se haya corrompido. */
export async function leerArtefacto(
  tenantId: string,
  paymentId: string,
  kind: TipoArtefacto,
): Promise<ArtefactoGuardado | null> {
  const { rows } = await db.query<ArtefactoGuardado>(
    `SELECT kind, content, content_type, bytes, sha256, invoice_number, archived_at
     FROM invoice_archive
     WHERE tenant_id = $1 AND payment_id = $2 AND kind = $3`,
    [tenantId, paymentId, kind],
  );
  if (!rows[0]) return null;

  const guardado = rows[0];
  if (hash(guardado.content) !== guardado.sha256) {
    // Se avisa y **no se devuelve**: entregar como auténtico un documento que no
    // coincide con su hash es peor que decir que se perdió.
    logger.error(
      { paymentId, kind, esperado: guardado.sha256 },
      'El documento archivado no coincide con su hash: está corrupto',
    );
    throw new Error(
      'El documento archivado no coincide con su hash. Está corrupto y no se entrega como auténtico.',
    );
  }

  return guardado;
}

export interface Integridad {
  total: number;
  corruptos: { payment_id: string; kind: string; invoice_number: string | null }[];
}

/**
 * Recorre el archivo y verifica cada hash.
 *
 * Para correr de vez en cuando: la corrupción silenciosa de un respaldo no avisa,
 * y descubrirla el día que la DIAN pide el documento es tarde.
 */
export async function verificarIntegridad(tenantId?: string): Promise<Integridad> {
  const { rows } = await db.query<{
    payment_id: string; kind: string; invoice_number: string | null;
    content: Buffer; sha256: string;
  }>(
    `SELECT payment_id, kind, invoice_number, content, sha256
     FROM invoice_archive
     ${tenantId ? 'WHERE tenant_id = $1' : ''}
     ORDER BY archived_at`,
    tenantId ? [tenantId] : [],
  );

  const corruptos = rows
    .filter((r) => hash(r.content) !== r.sha256)
    .map((r) => ({ payment_id: r.payment_id, kind: r.kind, invoice_number: r.invoice_number }));

  return { total: rows.length, corruptos };
}
