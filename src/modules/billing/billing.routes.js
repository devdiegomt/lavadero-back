/**
 * Billing Routes — Facturación Electrónica DIAN
 */

const { Router } = require('express');
const ctrl = require('./billing.controller');
const { authenticate, authorize, requireTenant } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');
const { planFeature } = require('../../shared/middleware/planLimits');

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

// ── Configuración ────────────────────────────────────────────────────
// Estado de configuración fiscal
router.get('/config', authorize('admin'), asyncHandler(ctrl.getConfig));

// Probar conexión con Alegra
router.post('/config/test', authorize('admin'), asyncHandler(ctrl.testConnection));

// Sincronizar servicios con Alegra
router.post('/sync-services', authorize('admin'), asyncHandler(ctrl.syncServices));


module.exports = router;
