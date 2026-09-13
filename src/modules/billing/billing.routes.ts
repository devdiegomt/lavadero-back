/**
 * Billing Routes — Facturación Electrónica DIAN
 */

import { Router } from 'express';
import * as ctrl from './billing.controller';
import { authenticate, authorize, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { planFeature } from '../../shared/middleware/planLimits';
import { validate, validarUuid, schemas } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, requireTenant);

// ── Facturación ──────────────────────────────────────────────────────
// Generar factura electrónica para un pago
router.post('/invoice/:paymentId', validarUuid('paymentId'), planFeature('billing'), asyncHandler(ctrl.generateInvoice));

// Consultar estado de factura (refresca desde DIAN)
router.get('/invoice/:paymentId', validarUuid('paymentId'), asyncHandler(ctrl.getInvoiceStatus));

// Reintentar factura fallida
router.post('/retry/:paymentId', validarUuid('paymentId'), asyncHandler(ctrl.retryInvoice));

// ── Notas Crédito ────────────────────────────────────────────────────
// Generar nota crédito (anulación/devolución)
router.post('/credit-note/:paymentId', validarUuid('paymentId'), authorize('admin'), asyncHandler(ctrl.createCreditNote));

// ── Listados ─────────────────────────────────────────────────────────
// Lista de facturas emitidas
router.get('/invoices', validate(schemas.queryListado, 'query'), asyncHandler(ctrl.listInvoices));

// Pagos pendientes de facturar (sin invoice_id o invoice_status = 'failed')
router.get('/pending', validate(schemas.queryListado, 'query'), asyncHandler(ctrl.listPendingPayments));

// ── Configuración ────────────────────────────────────────────────────
// Estado de configuración fiscal
router.get('/config', authorize('admin'), asyncHandler(ctrl.getConfig));

// Guardar las credenciales de Alegra. Se cifran antes de escribirlas, y es la
// única vía que lo hace: por SQL se puede guardar texto plano, y eso ahora
// revienta al leerlo en vez de pasar desapercibido.
router.put(
  '/config/credentials',
  authorize('admin'),
  validate(schemas.billingCredentials),
  asyncHandler(ctrl.setCredentials),
);

// Descargar la copia propia de una factura. Ver modules/billing/archivo.ts.
router.get(
  '/archivo/:paymentId/:kind',
  validarUuid('paymentId'),
  asyncHandler(ctrl.descargarArchivada),
);

// Probar conexión con Alegra
router.post('/config/test', authorize('admin'), asyncHandler(ctrl.testConnection));

// Sincronizar servicios con Alegra
router.post('/sync-services', authorize('admin'), asyncHandler(ctrl.syncServices));


export default router;