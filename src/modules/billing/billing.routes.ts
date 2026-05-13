/**
 * Billing Routes — Facturación Electrónica DIAN
 */

import { Router } from 'express';
import * as ctrl from './billing.controller';
import { authenticate, authorize, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { planFeature } from '../../shared/middleware/planLimits';

const router = Router();
router.use(authenticate, requireTenant);

// ── Facturación ──────────────────────────────────────────────────────
// Generar factura electrónica para un pago
router.post('/invoice/:paymentId', planFeature('billing'), asyncHandler(ctrl.generateInvoice));

// Consultar estado de factura (refresca desde DIAN)
router.get('/invoice/:paymentId', asyncHandler(ctrl.getInvoiceStatus));

// Reintentar factura fallida
router.post('/retry/:paymentId', asyncHandler(ctrl.retryInvoice));

// ── Notas Crédito ────────────────────────────────────────────────────
// Generar nota crédito (anulación/devolución)
router.post('/credit-note/:paymentId', authorize('admin'), asyncHandler(ctrl.createCreditNote));

// ── Listados ─────────────────────────────────────────────────────────
// Lista de facturas emitidas
router.get('/invoices', asyncHandler(ctrl.listInvoices));

// Pagos pendientes de facturar (sin invoice_id o invoice_status = 'failed')
router.get('/pending', asyncHandler(ctrl.listPendingPayments));

// ── Configuración ────────────────────────────────────────────────────
// Estado de configuración fiscal
router.get('/config', authorize('admin'), asyncHandler(ctrl.getConfig));

// Probar conexión con Alegra
router.post('/config/test', authorize('admin'), asyncHandler(ctrl.testConnection));

// Sincronizar servicios con Alegra
router.post('/sync-services', authorize('admin'), asyncHandler(ctrl.syncServices));


export default router;