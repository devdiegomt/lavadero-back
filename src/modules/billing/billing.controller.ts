/**
 * Billing Controller — Facturación Electrónica DIAN vía Alegra.
 *
 * Flujo principal:
 *   1. Se registra un pago en payments.controller.ts
 *   2. Si el tenant tiene billing_provider configurado, se genera factura
 *   3. La factura se emite electrónicamente ante la DIAN
 *   4. Se almacena referencia (número, CUFE, PDF URL, estado)
 *
 * Endpoints:
 *   POST   /api/billing/invoice/:paymentId    — Genera factura para un pago
 *   GET    /api/billing/invoice/:paymentId     — Consulta estado de factura
 *   GET    /api/billing/invoices               — Lista de facturas del tenant
 *   POST   /api/billing/credit-note/:paymentId — Genera nota crédito (anulación)
 *   POST   /api/billing/retry/:paymentId       — Reintenta factura fallida
 *   GET    /api/billing/config                 — Estado de configuración fiscal
 *   POST   /api/billing/config/test            — Prueba conexión con Alegra
 *   POST   /api/billing/sync-services          — Sincroniza servicios con Alegra
 */

import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import type { TenantRow } from '../../types/entities';

// `alegra.client` y `billing.sync` aún viven como .js — usamos firmas mínimas tipadas
// para que el TS-strict compile mientras se migran.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createAlegraClientForTenant } = require('./alegra.client') as {
  createAlegraClientForTenant(tenant: TenantRow): AlegraClient;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  syncCustomerToAlegra, syncServiceToAlegra, syncAllServicesToAlegra,
} = require('./billing.sync') as {
  syncCustomerToAlegra(customerId: string, tenantId: string): Promise<string>;
  syncServiceToAlegra(serviceId: string, tenantId: string, vehicleType: string): Promise<{ alegraItemId: string; price: number }>;
  syncAllServicesToAlegra(tenantId: string): Promise<SyncResult[]>;
};

// ─── Tipos del cliente Alegra ────────────────────────────────────────────────

interface SyncResult { status: 'ok' | 'error'; serviceId?: string; error?: string }

interface AlegraStamp { status?: string; cufe?: string; date?: string; legalStatus?: string }

interface AlegraNumberTemplate {
  id: number;
  name?: string;
  fullNumber?: string;
  prefix?: string;
  maxInvoiceNumber?: number;
  resolution?: string;
  status?: string;
}

interface AlegraInvoice {
  id: number | string;
  number?: number | string;
  numberTemplate?: { prefix?: string; id?: number };
  stamp?: AlegraStamp;
  pdf?: string;
}

interface AlegraCreditNote {
  id: number | string;
  number: number | string;
}

interface AlegraCompanyInfo { name: string; identification?: string }

interface AlegraInvoiceItem {
  id: number;
  price: number;
  quantity: number;
  description: string;
}

interface AlegraInvoicePayload {
  date: string;
  dueDate: string;
  client: { id: number };
  items: AlegraInvoiceItem[];
  paymentMethod: string;
  observations: string;
  stamp?: { generateStamp: boolean };
  numberTemplate?: { id: number };
}

interface AlegraCreditNotePayload {
  date: string;
  client: { id: number };
  items: AlegraInvoiceItem[];
  invoices: Array<{ id: number }>;
  cause: string;
  observations: string;
}

interface AlegraClient {
  createInvoice(payload: AlegraInvoicePayload): Promise<AlegraInvoice>;
  getInvoice(id: string): Promise<AlegraInvoice>;
  createCreditNote(payload: AlegraCreditNotePayload): Promise<AlegraCreditNote>;
  sendInvoiceByEmail(id: number | string, email: string): Promise<void>;
  getCompanyInfo(): Promise<AlegraCompanyInfo>;
  listNumberTemplates(): Promise<AlegraNumberTemplate[]>;
  listTaxes(): Promise<Array<{ id: number; name: string }>>;
}

interface AlegraError extends Error {
  alegraError?: unknown;
}

// ─── Tipos de filas de BD ────────────────────────────────────────────────────

type PaymentWithJoinsRow = {
  id: string; tenant_id: string; appointment_id: string; amount: number;
  payment_method: string; created_at: Date;
  invoice_id: string | null; invoice_number: string | null; invoice_cufe: string | null;
  invoice_pdf_url: string | null; invoice_status: string | null;
  customer_id: string; vehicle_id: string; service_id: string; scheduled_date: string;
  first_name: string; last_name: string | null;
  customer_phone: string; customer_email: string | null;
  document_type: string | null; document_number: string | null;
  plate: string; vehicle_type: string;
  service_name: string; service_description: string | null;
};

// ─────────────────────────────────────────────────────────────────────────
// POST /api/billing/invoice/:paymentId
// ─────────────────────────────────────────────────────────────────────────

export async function generateInvoice(req: Request, res: Response): Promise<void> {
  const { paymentId } = req.params;

  // 1. Obtener pago con todos los datos necesarios
  const { rows } = await db.query<PaymentWithJoinsRow>(
    `SELECT p.*,
            a.customer_id, a.vehicle_id, a.service_id, a.scheduled_date,
            c.first_name, c.last_name, c.phone as customer_phone, c.email as customer_email,
            c.document_type, c.document_number,
            v.plate, v.vehicle_type,
            s.name as service_name, s.description as service_description
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles  v ON v.id = a.vehicle_id
     JOIN services  s ON s.id = a.service_id
     WHERE p.id = $1 AND p.tenant_id = $2`,
    [paymentId, req.tenantId],
  );

  if (rows.length === 0) throw new AppError('Pago no encontrado', 404);
  const payment = rows[0];

  // Verificar que no tenga factura ya
  if (payment.invoice_id) {
    throw new AppError('Este pago ya tiene una factura generada', 409);
  }

  // 2. Obtener tenant con config de facturación
  const { rows: tenantRows } = await db.query<TenantRow>(
    'SELECT * FROM tenants WHERE id = $1',
    [req.tenantId],
  );
  const tenant = tenantRows[0];

  if (!tenant.billing_provider) {
    throw new AppError(
      'La facturación electrónica no está configurada. Ve a Configuración → Facturación.',
      400,
    );
  }

  const alegra = createAlegraClientForTenant(tenant);

  try {
    // 3. Sincronizar cliente con Alegra
    const alegraContactId = await syncCustomerToAlegra(payment.customer_id, req.tenantId!);

    // 4. Sincronizar servicio con Alegra
    const { alegraItemId, price } = await syncServiceToAlegra(
      payment.service_id, req.tenantId!, payment.vehicle_type,
    );

    // 5. Crear factura en Alegra
    const today = new Date().toISOString().split('T')[0];
    const invoice = await alegra.createInvoice({
      date: today,
      dueDate: today,
      client: { id: parseInt(alegraContactId, 10) },
      items: [{
        id: parseInt(alegraItemId, 10),
        price,
        quantity: 1,
        description: `${payment.service_name} — Placa ${payment.plate} (${payment.vehicle_type})`,
      }],
      paymentMethod: payment.payment_method,
      observations: `Lavadero: ${tenant.name}\nPlaca: ${payment.plate}\nFecha servicio: ${payment.scheduled_date}`,
      stamp: { generateStamp: true },
      numberTemplate: tenant.billing_resolution
        ? { id: parseInt(tenant.billing_resolution, 10) }
        : undefined,
    });

    // 6. Extraer datos de la factura generada
    const invoiceNumber = invoice.numberTemplate
      ? `${invoice.numberTemplate.prefix ?? ''}${invoice.number}`
      : invoice.number?.toString() ?? null;

    const cufe          = invoice.stamp?.cufe ?? null;
    const pdfUrl        = invoice.pdf ?? null;
    const invoiceStatus = invoice.stamp?.status ?? 'pending';

    // 7. Actualizar el pago con la referencia de la factura
    await db.query(
      `UPDATE payments SET
         invoice_id      = $1,
         invoice_number  = $2,
         invoice_cufe    = $3,
         invoice_pdf_url = $4,
         invoice_status  = $5
       WHERE id = $6`,
      [
        invoice.id.toString(),
        invoiceNumber,
        cufe,
        pdfUrl,
        invoiceStatus,
        paymentId,
      ],
    );

    // 8. Si el cliente tiene email, enviar factura
    if (payment.customer_email) {
      try {
        await alegra.sendInvoiceByEmail(invoice.id, payment.customer_email);
      } catch (emailErr) {
        console.error('[Billing] Error enviando factura por email:', (emailErr as Error).message);
        // No bloquear por error de envío de email
      }
    }

    res.status(201).json({
      message: 'Factura generada exitosamente',
      invoice: {
        id: invoice.id,
        number: invoiceNumber,
        cufe,
        pdfUrl,
        status: invoiceStatus,
        total: price,
        client: `${payment.first_name} ${payment.last_name ?? ''}`.trim(),
      },
    });
  } catch (err) {
    // Registrar el intento fallido
    await db.query(
      `UPDATE payments SET invoice_status = 'failed' WHERE id = $1`,
      [paymentId],
    );

    // Guardar error para diagnóstico
    await logBillingError(req.tenantId!, paymentId, err as AlegraError);

    const alegraErr = err as AlegraError;
    if (alegraErr.alegraError) {
      throw new AppError(
        `Error de Alegra: ${alegraErr.message}. Verifica la configuración fiscal.`,
        502,
        alegraErr.alegraError,
      );
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/billing/invoice/:paymentId
// ─────────────────────────────────────────────────────────────────────────

type InvoiceStatusRow = {
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_cufe: string | null;
  invoice_pdf_url: string | null;
  invoice_status: string | null;
  amount: number;
  payment_method: string;
  created_at: Date;
  first_name: string;
  last_name: string | null;
  customer_email: string | null;
  service_name: string;
  plate: string;
};

export async function getInvoiceStatus(req: Request, res: Response): Promise<void> {
  const { paymentId } = req.params;

  const { rows } = await db.query<InvoiceStatusRow>(
    `SELECT p.invoice_id, p.invoice_number, p.invoice_cufe, p.invoice_pdf_url, p.invoice_status,
            p.amount, p.payment_method, p.created_at,
            c.first_name, c.last_name, c.email as customer_email,
            s.name as service_name, v.plate
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles  v ON v.id = a.vehicle_id
     JOIN services  s ON s.id = a.service_id
     WHERE p.id = $1 AND p.tenant_id = $2`,
    [paymentId, req.tenantId],
  );

  if (rows.length === 0) throw new AppError('Pago no encontrado', 404);
  const payment = rows[0];

  if (!payment.invoice_id) {
    res.json({ hasInvoice: false, payment: { id: paymentId } });
    return;
  }

  // Consultar estado actualizado en Alegra
  let alegraInvoice: AlegraInvoice | null = null;
  try {
    const tenant = await getTenant(req.tenantId!);
    const alegra = createAlegraClientForTenant(tenant);
    alegraInvoice = await alegra.getInvoice(payment.invoice_id);

    // Actualizar estado local si cambió
    const newStatus = alegraInvoice.stamp?.status ?? payment.invoice_status;
    const newCufe   = alegraInvoice.stamp?.cufe ?? payment.invoice_cufe;
    const newPdf    = alegraInvoice.pdf ?? payment.invoice_pdf_url;

    if (newStatus !== payment.invoice_status || newCufe !== payment.invoice_cufe) {
      await db.query(
        `UPDATE payments SET invoice_status = $1, invoice_cufe = $2, invoice_pdf_url = $3 WHERE id = $4`,
        [newStatus, newCufe, newPdf, paymentId],
      );
    }

    payment.invoice_status  = newStatus;
    payment.invoice_cufe    = newCufe;
    payment.invoice_pdf_url = newPdf;
  } catch (err) {
    console.error('[Billing] Error consultando factura en Alegra:', (err as Error).message);
    // Retornar datos locales si Alegra no responde
  }

  res.json({
    hasInvoice: true,
    invoice: {
      id:            payment.invoice_id,
      number:        payment.invoice_number,
      cufe:          payment.invoice_cufe,
      pdfUrl:        payment.invoice_pdf_url,
      status:        payment.invoice_status,
      amount:        payment.amount,
      paymentMethod: payment.payment_method,
      serviceName:   payment.service_name,
      plate:         payment.plate,
      customer:      `${payment.first_name} ${payment.last_name ?? ''}`.trim(),
      customerEmail: payment.customer_email,
      createdAt:     payment.created_at,
    },
    dianDetails: alegraInvoice?.stamp ?? null,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/billing/invoices?page=1&limit=20&status=accepted
// ─────────────────────────────────────────────────────────────────────────

type InvoiceListRow = {
  id: string;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_cufe: string | null;
  invoice_pdf_url: string | null;
  invoice_status: string | null;
  amount: number;
  payment_method: string;
  created_at: Date;
  first_name: string;
  last_name: string | null;
  document_number: string | null;
  plate: string;
  service_name: string;
};

type SummaryRow = {
  total: string; accepted: string; rejected: string;
  failed: string; pending_dian: string; total_invoiced: string;
};

export async function listInvoices(req: Request, res: Response): Promise<void> {
  const { page = '1', limit = '20', status, from, to } = req.query as Record<string, string | undefined>;
  const pageN  = parseInt(page, 10);
  const limitN = parseInt(limit, 10);
  const offset = (pageN - 1) * limitN;

  const params: (string | number)[] = [req.tenantId!];
  const conditions = ['p.tenant_id = $1', 'p.invoice_id IS NOT NULL'];

  if (status) { params.push(status); conditions.push(`p.invoice_status = $${params.length}`); }
  if (from)   { params.push(from);   conditions.push(`p.created_at >= $${params.length}::date`); }
  if (to)     { params.push(`${to} 23:59:59`); conditions.push(`p.created_at <= $${params.length}::timestamp`); }

  const where = conditions.join(' AND ');

  const { rows: countRows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) FROM payments p WHERE ${where}`,
    params,
  );

  params.push(limitN, offset);
  const { rows } = await db.query<InvoiceListRow>(
    `SELECT p.id, p.invoice_id, p.invoice_number, p.invoice_cufe, p.invoice_pdf_url,
            p.invoice_status, p.amount, p.payment_method, p.created_at,
            c.first_name, c.last_name, c.document_number,
            v.plate, s.name as service_name
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles  v ON v.id = a.vehicle_id
     JOIN services  s ON s.id = a.service_id
     WHERE ${where}
     ORDER BY p.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  // Resumen
  const { rows: summaryRows } = await db.query<SummaryRow>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE invoice_status = 'accepted') as accepted,
       COUNT(*) FILTER (WHERE invoice_status = 'rejected') as rejected,
       COUNT(*) FILTER (WHERE invoice_status = 'failed') as failed,
       COUNT(*) FILTER (WHERE invoice_status = 'pending') as pending_dian,
       COALESCE(SUM(amount) FILTER (WHERE invoice_status = 'accepted'), 0) as total_invoiced
     FROM payments
     WHERE tenant_id = $1 AND invoice_id IS NOT NULL`,
    [req.tenantId],
  );

  res.json({
    data: rows,
    summary: {
      total:         parseInt(summaryRows[0].total, 10),
      accepted:      parseInt(summaryRows[0].accepted, 10),
      rejected:      parseInt(summaryRows[0].rejected, 10),
      failed:        parseInt(summaryRows[0].failed, 10),
      pendingDian:   parseInt(summaryRows[0].pending_dian, 10),
      totalInvoiced: parseInt(summaryRows[0].total_invoiced, 10),
    },
    pagination: {
      total: parseInt(countRows[0].count, 10),
      page:  pageN,
      limit: limitN,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/billing/pending?page=1&limit=20
// Pagos registrados que aún no tienen factura emitida (o cuya factura falló).
// ─────────────────────────────────────────────────────────────────────────

type PendingPaymentRow = {
  id: string;
  amount: number;
  payment_method: string;
  created_at: Date;
  invoice_status: string | null;
  document_number: string | null;
  first_name: string;
  last_name: string | null;
  plate: string;
  service_name: string;
  received_by_name: string | null;
};

export async function listPendingPayments(req: Request, res: Response): Promise<void> {
  const { page = '1', limit = '20' } = req.query as Record<string, string | undefined>;
  const pageN  = parseInt(page, 10);
  const limitN = parseInt(limit, 10);
  const offset = (pageN - 1) * limitN;

  // "Pendiente" = pago sin invoice_id O con invoice_status = 'failed'
  // (un failed se considera pendiente porque está esperando reintento).
  const whereClause = `p.tenant_id = $1
    AND (p.invoice_id IS NULL OR p.invoice_status = 'failed')`;

  const { rows: countRows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) FROM payments p WHERE ${whereClause}`,
    [req.tenantId],
  );

  const { rows } = await db.query<PendingPaymentRow>(
    `SELECT p.id, p.amount, p.payment_method, p.created_at, p.invoice_status,
            c.first_name, c.last_name, c.document_number,
            v.plate, s.name AS service_name,
            COALESCE(u.first_name || ' ' || COALESCE(u.last_name, ''), '') AS received_by_name
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles  v ON v.id = a.vehicle_id
     JOIN services  s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = p.received_by
     WHERE ${whereClause}
     ORDER BY p.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.tenantId, limitN, offset],
  );

  res.json({
    data: rows,
    pagination: {
      total: parseInt(countRows[0].count, 10),
      page:  pageN,
      limit: limitN,
    },
  });
}

export async function createCreditNote(req: Request, res: Response): Promise<void> {
  const { paymentId } = req.params;
  const { reason } = req.body as { reason?: string };

  const { rows } = await db.query<PaymentWithJoinsRow>(
    `SELECT p.*, c.first_name, c.last_name, s.name as service_name, v.plate, v.vehicle_type
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles  v ON v.id = a.vehicle_id
     JOIN services  s ON s.id = a.service_id
     WHERE p.id = $1 AND p.tenant_id = $2`,
    [paymentId, req.tenantId],
  );

  if (rows.length === 0) throw new AppError('Pago no encontrado', 404);
  const payment = rows[0];

  if (!payment.invoice_id) {
    throw new AppError('Este pago no tiene factura asociada', 400);
  }

  const tenant = await getTenant(req.tenantId!);
  const alegra = createAlegraClientForTenant(tenant);

  // Obtener el contacto de Alegra
  const alegraContactId = await syncCustomerToAlegra(payment.customer_id, req.tenantId!);

  // Obtener el ítem de Alegra
  const { alegraItemId, price } = await syncServiceToAlegra(
    payment.service_id, req.tenantId!, payment.vehicle_type,
  );

  const creditNote = await alegra.createCreditNote({
    date: new Date().toISOString().split('T')[0],
    client: { id: parseInt(alegraContactId, 10) },
    items: [{
      id: parseInt(alegraItemId, 10),
      price,
      quantity: 1,
      description: `Anulación: ${payment.service_name} — Placa ${payment.plate}`,
    }],
    invoices: [{ id: parseInt(payment.invoice_id, 10) }],
    cause: '2', // Anulación de factura
    observations: reason ?? 'Anulación de servicio',
  });

  // Actualizar estado de la factura
  await db.query(
    `UPDATE payments SET invoice_status = 'voided' WHERE id = $1`,
    [paymentId],
  );

  res.status(201).json({
    message: 'Nota crédito generada',
    creditNote: {
      id: creditNote.id,
      number: creditNote.number,
      invoiceAnulled: payment.invoice_number,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/billing/retry/:paymentId
// ─────────────────────────────────────────────────────────────────────────

export async function retryInvoice(req: Request, res: Response): Promise<void> {
  const { paymentId } = req.params;

  const { rows } = await db.query<{ invoice_status: string | null }>(
    'SELECT invoice_status FROM payments WHERE id = $1 AND tenant_id = $2',
    [paymentId, req.tenantId],
  );

  if (rows.length === 0) throw new AppError('Pago no encontrado', 404);
  if (rows[0].invoice_status && rows[0].invoice_status !== 'failed') {
    throw new AppError('Solo se pueden reintentar facturas con estado "failed"', 400);
  }

  // Limpiar datos de factura anterior
  await db.query(
    `UPDATE payments SET invoice_id = NULL, invoice_number = NULL, invoice_cufe = NULL,
     invoice_pdf_url = NULL, invoice_status = NULL WHERE id = $1`,
    [paymentId],
  );

  // Reutilizar la función de generación
  await generateInvoice(req, res);
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/billing/config
// ─────────────────────────────────────────────────────────────────────────

export async function getConfig(req: Request, res: Response): Promise<void> {
  const tenant = await getTenant(req.tenantId!);

  const isConfigured = !!(tenant.billing_provider && tenant.billing_api_key);
  let connectionOk = false;
  let companyInfo: AlegraCompanyInfo | null = null;
  let numberTemplates: AlegraNumberTemplate[] = [];

  if (isConfigured) {
    try {
      const alegra = createAlegraClientForTenant(tenant);
      companyInfo     = await alegra.getCompanyInfo();
      numberTemplates = await alegra.listNumberTemplates();
      connectionOk = true;
    } catch (err) {
      console.error('[Billing] Error verificando conexión:', (err as Error).message);
    }
  }

  res.json({
    provider:    tenant.billing_provider ?? null,
    isConfigured,
    connectionOk,
    resolution:  tenant.billing_resolution ?? null,
    prefix:      tenant.billing_prefix ?? null,
    nit:         tenant.nit ?? null,
    companyName: companyInfo?.name ?? tenant.name,
    numberTemplates: numberTemplates.map((nt) => ({
      id:            nt.id,
      name:          nt.name ?? nt.fullNumber,
      prefix:        nt.prefix,
      currentNumber: nt.maxInvoiceNumber,
      resolution:    nt.resolution,
      status:        nt.status,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/billing/config/test
// ─────────────────────────────────────────────────────────────────────────

export async function testConnection(req: Request, res: Response): Promise<void> {
  const tenant = await getTenant(req.tenantId!);

  if (!tenant.billing_provider || !tenant.billing_api_key) {
    throw new AppError('Configura primero billing_provider y billing_api_key', 400);
  }

  try {
    const alegra = createAlegraClientForTenant(tenant);
    const [company, templates, taxes] = await Promise.all([
      alegra.getCompanyInfo(),
      alegra.listNumberTemplates(),
      alegra.listTaxes(),
    ]);

    res.json({
      success: true,
      company: {
        name: company.name,
        identification: company.identification,
      },
      numberTemplates: templates.length,
      taxes: taxes.length,
      message: 'Conexión con Alegra exitosa',
    });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: (err as Error).message,
      hint: 'Verifica que el email y token en billing_api_key sean correctos (formato: email:token)',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/billing/sync-services
// ─────────────────────────────────────────────────────────────────────────

export async function syncServices(req: Request, res: Response): Promise<void> {
  const results = await syncAllServicesToAlegra(req.tenantId!);

  const ok     = results.filter((r) => r.status === 'ok').length;
  const errors = results.filter((r) => r.status === 'error').length;

  res.json({
    message: `Sincronización completada: ${ok} exitosos, ${errors} con error`,
    results,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getTenant(tenantId: string): Promise<TenantRow> {
  const { rows } = await db.query<TenantRow>(
    'SELECT * FROM tenants WHERE id = $1',
    [tenantId],
  );
  if (rows.length === 0) throw new AppError('Tenant no encontrado', 404);
  return rows[0];
}

async function logBillingError(tenantId: string, paymentId: string, error: AlegraError): Promise<void> {
  try {
    await db.query(
      `INSERT INTO billing_errors (tenant_id, payment_id, error_message, error_details)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, paymentId, error.message, JSON.stringify(error.alegraError ?? {})],
    );
  } catch (logErr) {
    console.error('[Billing] Error logging billing error:', (logErr as Error).message);
  }
}