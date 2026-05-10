/**
 * Billing Controller — Facturación Electrónica DIAN vía Alegra
 * 
 * Flujo principal:
 *   1. Se registra un pago en payments.controller.js
 *   2. Si el tenant tiene billing_provider configurado, se genera factura
 *   3. La factura se emite electrónicamente ante la DIAN
 *   4. Se almacena referencia (número, CUFE, PDF URL, estado)
 * 
 * Endpoints:
 *   POST   /api/billing/invoice/:paymentId    — Genera factura para un pago
 *   GET    /api/billing/invoice/:paymentId     — Consulta estado de factura
 *   GET    /api/billing/invoices               — Lista de facturas del tenant
 *   GET    /api/billing/pending                — Pagos sin factura (pendientes de facturar)
 *   POST   /api/billing/credit-note/:paymentId — Genera nota crédito (anulación)
 *   POST   /api/billing/retry/:paymentId       — Reintenta factura fallida
 *   GET    /api/billing/config                 — Estado de configuración fiscal
 *   PATCH  /api/billing/config                 — Guarda configuración fiscal (cifra API key)
 *   POST   /api/billing/config/test            — Prueba conexión con Alegra
 *   POST   /api/billing/sync-services          — Sincroniza servicios con Alegra
 */

const db = require('../../shared/db');
const { AppError } = require('../../shared/middleware/errorHandler');
const { createAlegraClientForTenant } = require('./alegra.client');
const { syncCustomerToAlegra, syncServiceToAlegra, syncAllServicesToAlegra } = require('./billing.sync');
const { centsToPesos, formatCOP } = require('../../shared/utils/pricing');
const { encrypt } = require('../../shared/utils/crypto');

// ─────────────────────────────────────────────────────────────────────────
// POST /api/billing/invoice/:paymentId
// Genera factura electrónica para un pago existente.
// ─────────────────────────────────────────────────────────────────────────
async function generateInvoice(req, res) {
  const { paymentId } = req.params;

  // 1. Obtener pago con todos los datos necesarios
  const { rows } = await db.query(
    `SELECT p.*, 
            a.customer_id, a.vehicle_id, a.service_id, a.scheduled_date,
            c.first_name, c.last_name, c.phone as customer_phone, c.email as customer_email,
            c.document_type, c.document_number,
            v.plate, v.vehicle_type,
            s.name as service_name, s.description as service_description
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     WHERE p.id = $1 AND p.tenant_id = $2`,
    [paymentId, req.tenantId]
  );

  if (rows.length === 0) throw new AppError('Pago no encontrado', 404);
  const payment = rows[0];

  // Verificar que no tenga factura ya
  if (payment.invoice_id) {
    throw new AppError('Este pago ya tiene una factura generada', 409);
  }

  // 2. Obtener tenant con config de facturación
  const { rows: tenantRows } = await db.query(
    'SELECT * FROM tenants WHERE id = $1', [req.tenantId]
  );
  const tenant = tenantRows[0];

  if (!tenant.billing_provider) {
    throw new AppError('La facturación electrónica no está configurada. Ve a Configuración → Facturación.', 400);
  }

  const alegra = createAlegraClientForTenant(tenant);

  try {
    // 3. Sincronizar cliente con Alegra
    const alegraContactId = await syncCustomerToAlegra(payment.customer_id, req.tenantId);

    // 4. Sincronizar servicio con Alegra
    const { alegraItemId, price } = await syncServiceToAlegra(
      payment.service_id, req.tenantId, payment.vehicle_type
    );

    // 5. Crear factura en Alegra
    const today = new Date().toISOString().split('T')[0];
    const invoice = await alegra.createInvoice({
      date: today,
      dueDate: today,
      client: { id: parseInt(alegraContactId) },
      items: [{
        id: parseInt(alegraItemId),
        price,
        quantity: 1,
        description: `${payment.service_name} — Placa ${payment.plate} (${payment.vehicle_type})`,
      }],
      paymentMethod: payment.payment_method,
      observations: `Lavadero: ${tenant.name}\nPlaca: ${payment.plate}\nFecha servicio: ${payment.scheduled_date}`,
      stamp: { generateStamp: true }, // Emitir electrónicamente
      numberTemplate: tenant.billing_resolution
        ? { id: parseInt(tenant.billing_resolution) }
        : undefined,
    });

    // 6. Extraer datos de la factura generada
    const invoiceNumber = invoice.numberTemplate
      ? `${invoice.numberTemplate.prefix || ''}${invoice.number}`
      : invoice.number?.toString();

    const cufe = invoice.stamp?.cufe || null;
    const pdfUrl = invoice.pdf || null;
    const invoiceStatus = invoice.stamp?.status || 'pending';

    // 7. Actualizar el pago con la referencia de la factura
    await db.query(
      `UPDATE payments SET
        invoice_id = $1,
        invoice_number = $2,
        invoice_cufe = $3,
        invoice_pdf_url = $4,
        invoice_status = $5
       WHERE id = $6`,
      [
        invoice.id.toString(),
        invoiceNumber,
        cufe,
        pdfUrl,
        invoiceStatus,
        paymentId,
      ]
    );

    // 8. Si el cliente tiene email, enviar factura
    if (payment.customer_email) {
      try {
        await alegra.sendInvoiceByEmail(invoice.id, payment.customer_email);
      } catch (emailErr) {
        console.error('[Billing] Error enviando factura por email:', emailErr.message);
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
        client: `${payment.first_name} ${payment.last_name || ''}`.trim(),
      },
    });
  } catch (err) {
    // Registrar el intento fallido
    await db.query(
      `UPDATE payments SET invoice_status = 'failed' WHERE id = $1`,
      [paymentId]
    );

    // Guardar error para diagnóstico
    await logBillingError(req.tenantId, paymentId, err);

    if (err.alegraError) {
      throw new AppError(
        `Error de Alegra: ${err.message}. Verifica la configuración fiscal.`,
        502,
        err.alegraError
      );
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/billing/invoice/:paymentId
// Consulta estado actual de la factura en Alegra (refresca desde DIAN).
// ─────────────────────────────────────────────────────────────────────────
async function getInvoiceStatus(req, res) {
  const { paymentId } = req.params;

  const { rows } = await db.query(
    `SELECT p.invoice_id, p.invoice_number, p.invoice_cufe, p.invoice_pdf_url, p.invoice_status,
            p.amount, p.payment_method, p.created_at,
            c.first_name, c.last_name, c.email as customer_email,
            s.name as service_name, v.plate
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     WHERE p.id = $1 AND p.tenant_id = $2`,
    [paymentId, req.tenantId]
  );

  if (rows.length === 0) throw new AppError('Pago no encontrado', 404);
  const payment = rows[0];

  if (!payment.invoice_id) {
    return res.json({ hasInvoice: false, payment: { id: paymentId } });
  }

  // Consultar estado actualizado en Alegra
  let alegraInvoice = null;
  try {
    const tenant = await getTenant(req.tenantId);
    const alegra = createAlegraClientForTenant(tenant);
    alegraInvoice = await alegra.getInvoice(payment.invoice_id);

    // Actualizar estado local si cambió
    const newStatus = alegraInvoice.stamp?.status || payment.invoice_status;
    const newCufe = alegraInvoice.stamp?.cufe || payment.invoice_cufe;
    const newPdf = alegraInvoice.pdf || payment.invoice_pdf_url;

    if (newStatus !== payment.invoice_status || newCufe !== payment.invoice_cufe) {
      await db.query(
        `UPDATE payments SET invoice_status = $1, invoice_cufe = $2, invoice_pdf_url = $3 WHERE id = $4`,
        [newStatus, newCufe, newPdf, paymentId]
      );
    }

    payment.invoice_status = newStatus;
    payment.invoice_cufe = newCufe;
    payment.invoice_pdf_url = newPdf;
  } catch (err) {
    console.error('[Billing] Error consultando factura en Alegra:', err.message);
    // Retornar datos locales si Alegra no responde
  }

  res.json({
    hasInvoice: true,
    invoice: {
      id: payment.invoice_id,
      number: payment.invoice_number,
      cufe: payment.invoice_cufe,
      pdfUrl: payment.invoice_pdf_url,
      status: payment.invoice_status,
      amount: payment.amount,
      paymentMethod: payment.payment_method,
      serviceName: payment.service_name,
      plate: payment.plate,
      customer: `${payment.first_name} ${payment.last_name || ''}`.trim(),
      customerEmail: payment.customer_email,
      createdAt: payment.created_at,
    },
    dianDetails: alegraInvoice?.stamp || null,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/billing/invoices?page=1&limit=20&status=accepted
// Lista todas las facturas emitidas por el tenant.
// ─────────────────────────────────────────────────────────────────────────
async function listInvoices(req, res) {
  const { page = 1, limit = 20, status, from, to } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [req.tenantId];
  let conditions = ['p.tenant_id = $1', 'p.invoice_id IS NOT NULL'];

  if (status) {
    params.push(status);
    conditions.push(`p.invoice_status = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`p.created_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to + ' 23:59:59');
    conditions.push(`p.created_at <= $${params.length}::timestamp`);
  }

  const where = conditions.join(' AND ');

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) FROM payments p WHERE ${where}`, params
  );

  params.push(parseInt(limit), offset);
  const { rows } = await db.query(
    `SELECT p.id, p.invoice_id, p.invoice_number, p.invoice_cufe, p.invoice_pdf_url,
            p.invoice_status, p.amount, p.payment_method, p.created_at,
            c.first_name, c.last_name, c.document_number,
            v.plate, s.name as service_name
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     WHERE ${where}
     ORDER BY p.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  // Resumen
  const { rows: summaryRows } = await db.query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE invoice_status = 'accepted') as accepted,
       COUNT(*) FILTER (WHERE invoice_status = 'rejected') as rejected,
       COUNT(*) FILTER (WHERE invoice_status = 'failed') as failed,
       COUNT(*) FILTER (WHERE invoice_status = 'pending') as pending_dian,
       COALESCE(SUM(amount) FILTER (WHERE invoice_status = 'accepted'), 0) as total_invoiced
     FROM payments
     WHERE tenant_id = $1 AND invoice_id IS NOT NULL`,
    [req.tenantId]
  );

  res.json({
    data: rows,
    summary: {
      total: parseInt(summaryRows[0].total),
      accepted: parseInt(summaryRows[0].accepted),
      rejected: parseInt(summaryRows[0].rejected),
      failed: parseInt(summaryRows[0].failed),
      pendingDian: parseInt(summaryRows[0].pending_dian),
      totalInvoiced: parseInt(summaryRows[0].total_invoiced),
    },
    pagination: {
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/billing/pending?page=1&limit=20&from=YYYY-MM-DD&to=YYYY-MM-DD
// Lista los pagos sin factura emitida (para poder facturarlos manualmente).
// ─────────────────────────────────────────────────────────────────────────
async function getPendingPayments(req, res) {
  const { page = 1, limit = 20, from, to } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [req.tenantId];
  let conditions = ['p.tenant_id = $1', 'p.invoice_id IS NULL'];

  if (from) {
    params.push(from);
    conditions.push(`p.created_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to + ' 23:59:59');
    conditions.push(`p.created_at <= $${params.length}::timestamp`);
  }

  const where = conditions.join(' AND ');

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) FROM payments p WHERE ${where}`, params
  );

  params.push(parseInt(limit), offset);
  const { rows } = await db.query(
    `SELECT p.id, p.amount, p.payment_method, p.created_at, p.invoice_status,
            c.first_name, c.last_name, c.phone, c.document_number, c.email,
            v.plate, v.vehicle_type,
            s.name AS service_name,
            u.first_name AS received_by_name
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     LEFT JOIN users u ON u.id = p.received_by
     WHERE ${where}
     ORDER BY p.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    data: rows,
    pagination: {
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/billing/credit-note/:paymentId
// Genera nota crédito (anulación/devolución).
// ─────────────────────────────────────────────────────────────────────────
async function createCreditNote(req, res) {
  const { paymentId } = req.params;
  const { reason } = req.body;

  const { rows } = await db.query(
    `SELECT p.*, c.first_name, c.last_name, s.name as service_name, v.plate, v.vehicle_type
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN vehicles v ON v.id = a.vehicle_id
     JOIN services s ON s.id = a.service_id
     WHERE p.id = $1 AND p.tenant_id = $2`,
    [paymentId, req.tenantId]
  );

  if (rows.length === 0) throw new AppError('Pago no encontrado', 404);
  const payment = rows[0];

  if (!payment.invoice_id) {
    throw new AppError('Este pago no tiene factura asociada', 400);
  }

  const tenant = await getTenant(req.tenantId);
  const alegra = createAlegraClientForTenant(tenant);

  // Obtener el contacto de Alegra
  const alegraContactId = await syncCustomerToAlegra(payment.customer_id, req.tenantId);

  // Obtener el ítem de Alegra
  const { alegraItemId, price } = await syncServiceToAlegra(
    payment.service_id, req.tenantId, payment.vehicle_type
  );

  const creditNote = await alegra.createCreditNote({
    date: new Date().toISOString().split('T')[0],
    client: { id: parseInt(alegraContactId) },
    items: [{
      id: parseInt(alegraItemId),
      price,
      quantity: 1,
      description: `Anulación: ${payment.service_name} — Placa ${payment.plate}`,
    }],
    invoices: [{ id: parseInt(payment.invoice_id) }],
    cause: '2', // Anulación de factura
    observations: reason || 'Anulación de servicio',
  });

  // Actualizar estado de la factura
  await db.query(
    `UPDATE payments SET invoice_status = 'voided' WHERE id = $1`,
    [paymentId]
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
// Reintenta generar una factura que falló.
// ─────────────────────────────────────────────────────────────────────────
async function retryInvoice(req, res) {
  const { paymentId } = req.params;

  const { rows } = await db.query(
    'SELECT invoice_status FROM payments WHERE id = $1 AND tenant_id = $2',
    [paymentId, req.tenantId]
  );

  if (rows.length === 0) throw new AppError('Pago no encontrado', 404);
  if (rows[0].invoice_status && rows[0].invoice_status !== 'failed') {
    throw new AppError('Solo se pueden reintentar facturas con estado "failed"', 400);
  }

  // Limpiar datos de factura anterior
  await db.query(
    `UPDATE payments SET invoice_id = NULL, invoice_number = NULL, invoice_cufe = NULL,
     invoice_pdf_url = NULL, invoice_status = NULL WHERE id = $1`,
    [paymentId]
  );

  // Reutilizar la función de generación
  await generateInvoice(req, res);
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/billing/config
// Retorna estado de configuración fiscal del tenant.
// ─────────────────────────────────────────────────────────────────────────
async function getConfig(req, res) {
  const tenant = await getTenant(req.tenantId);

  const isConfigured = !!(tenant.billing_provider && tenant.billing_api_key);
  let connectionOk = false;
  let companyInfo = null;
  let numberTemplates = [];

  if (isConfigured) {
    try {
      const alegra = createAlegraClientForTenant(tenant);
      companyInfo = await alegra.getCompanyInfo();
      numberTemplates = await alegra.listNumberTemplates();
      connectionOk = true;
    } catch (err) {
      console.error('[Billing] Error verificando conexión:', err.message);
    }
  }

  res.json({
    provider: tenant.billing_provider || null,
    isConfigured,
    connectionOk,
    resolution: tenant.billing_resolution || null,
    prefix: tenant.billing_prefix || null,
    nit: tenant.nit || null,
    companyName: companyInfo?.name || tenant.name,
    numberTemplates: numberTemplates.map(nt => ({
      id: nt.id,
      name: nt.name || nt.fullNumber,
      prefix: nt.prefix,
      currentNumber: nt.maxInvoiceNumber,
      resolution: nt.resolution,
      status: nt.status,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/billing/config
// Guarda configuración fiscal del tenant. La API key se cifra antes de
// almacenarse. Acepta los campos:
//   - provider:        'alegra' (por ahora solo Alegra)
//   - apiKey:          formato "email:token" (se cifra)
//   - resolution:      número de resolución DIAN
//   - prefix:          prefijo de facturación (ej. 'FE')
//   - nit:             NIT del lavadero (sincroniza con tenants.nit)
// Si apiKey llega vacío o no se envía, NO se sobrescribe la actual.
// ─────────────────────────────────────────────────────────────────────────
async function updateConfig(req, res) {
  const { provider, apiKey, resolution, prefix, nit } = req.body;

  const updates = [];
  const values = [];
  let i = 1;

  if (provider !== undefined) {
    if (provider && !['alegra', 'siigo'].includes(provider)) {
      throw new AppError('Provider inválido. Valores permitidos: alegra, siigo', 400);
    }
    updates.push(`billing_provider = $${i++}`);
    values.push(provider || null);
  }

  // apiKey se cifra solo si viene con valor; si viene null/empty se ignora
  // (para no borrar la key existente al guardar el resto del formulario)
  if (apiKey) {
    updates.push(`billing_api_key = $${i++}`);
    values.push(encrypt(apiKey.trim()));
  }

  if (resolution !== undefined) {
    updates.push(`billing_resolution = $${i++}`);
    values.push(resolution || null);
  }

  if (prefix !== undefined) {
    updates.push(`billing_prefix = $${i++}`);
    values.push(prefix || null);
  }

  if (nit !== undefined) {
    updates.push(`nit = $${i++}`);
    values.push(nit || null);
  }

  if (updates.length === 0) {
    throw new AppError('No hay campos para actualizar', 400);
  }

  values.push(req.tenantId);

  await db.query(
    `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${i}`,
    values
  );

  // Devolver el config refrescado (sin retornar la api key cifrada)
  return getConfig(req, res);
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/billing/config/test
// Prueba la conexión con Alegra.
// ─────────────────────────────────────────────────────────────────────────
async function testConnection(req, res) {
  const tenant = await getTenant(req.tenantId);

  if (!tenant.billing_provider || !tenant.billing_api_key) {
    throw new AppError('Configura primero billing_provider y billing_api_key', 400);
  }

  try {
    const alegra = createAlegraClientForTenant(tenant);
    const company = await alegra.getCompanyInfo();
    const templates = await alegra.listNumberTemplates();
    const taxes = await alegra.listTaxes();

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
      error: err.message,
      hint: 'Verifica que el email y token en billing_api_key sean correctos (formato: email:token)',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/billing/sync-services
// Sincroniza todos los servicios del lavadero con Alegra.
// ─────────────────────────────────────────────────────────────────────────
async function syncServices(req, res) {
  const results = await syncAllServicesToAlegra(req.tenantId);

  const ok = results.filter(r => r.status === 'ok').length;
  const errors = results.filter(r => r.status === 'error').length;

  res.json({
    message: `Sincronización completada: ${ok} exitosos, ${errors} con error`,
    results,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

async function getTenant(tenantId) {
  const { rows } = await db.query('SELECT * FROM tenants WHERE id = $1', [tenantId]);
  if (rows.length === 0) throw new AppError('Tenant no encontrado', 404);
  return rows[0];
}

async function logBillingError(tenantId, paymentId, error) {
  try {
    await db.query(
      `INSERT INTO billing_errors (tenant_id, payment_id, error_message, error_details)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, paymentId, error.message, JSON.stringify(error.alegraError || {})]
    );
  } catch (logErr) {
    console.error('[Billing] Error logging billing error:', logErr.message);
  }
}

module.exports = {
  generateInvoice,
  getInvoiceStatus,
  listInvoices,
  getPendingPayments,
  createCreditNote,
  retryInvoice,
  getConfig,
  updateConfig,
  testConnection,
  syncServices,
};