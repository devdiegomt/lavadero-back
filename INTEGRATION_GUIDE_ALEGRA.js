/**
 * ============================================================================
 * GUÍA DE INTEGRACIÓN — Fase 4: Facturación Electrónica DIAN
 * ============================================================================
 * 
 * Proveedor: Alegra (https://developer.alegra.com)
 * Autenticación: Basic Auth (email:token en Base64)
 */


// ============================================================================
// 1. EJECUTAR MIGRACIÓN
// ============================================================================
// Agrega al package.json:
//   "db:migrate-billing": "node src/shared/db/migrate-billing.js"
//
// Ejecutar:
//   npm run db:migrate-billing


// ============================================================================
// 2. REGISTRAR RUTAS EN index.js
// ============================================================================
// Agregar import:
//   const billingRoutes = require('./modules/billing/billing.routes');
//
// Agregar ruta:
//   app.use('/api/billing', billingRoutes);


// ============================================================================
// 3. VARIABLES DE ENTORNO
// ============================================================================
// No se necesitan variables globales. La configuración de Alegra
// es por TENANT (multi-tenant ready). Se almacena en la tabla tenants:
//
//   billing_provider: 'alegra'
//   billing_api_key: 'email@ejemplo.com:tokenDeAlegra'
//   billing_resolution: 'ID_de_la_numeración_en_Alegra'
//   billing_prefix: 'FE' (prefijo de factura)


// ============================================================================
// 4. CONFIGURAR UN TENANT PARA FACTURAR
// ============================================================================
// 
// Paso 1: Crear cuenta en Alegra (https://app.alegra.com)
// Paso 2: Habilitarse como facturador electrónico ante la DIAN
//         (Alegra lo hace automáticamente, tarda ~10 min)
// Paso 3: Obtener token API:
//         Alegra → Configuración → Integraciones → API
// Paso 4: Actualizar el tenant en la BD:
//
//   UPDATE tenants SET
//     billing_provider = 'alegra',
//     billing_api_key = 'admin@elbrillante.co:tu-token-de-alegra-aqui',
//     billing_resolution = '1',  -- ID de la numeración en Alegra
//     billing_prefix = 'FE',
//     nit = '900123456-7'
//   WHERE slug = 'el-brillante';
//
// Paso 5: Probar conexión:
//   POST /api/billing/config/test
//
// Paso 6: Sincronizar servicios:
//   POST /api/billing/sync-services


// ============================================================================
// 5. FLUJO DE USO
// ============================================================================
//
// Opción A: Factura manual (botón "Generar Factura" en el frontend)
//   1. Operador registra pago: POST /api/payments
//   2. Admin/operador genera factura: POST /api/billing/invoice/:paymentId
//   3. Factura se emite ante DIAN vía Alegra
//   4. Se almacena: invoice_id, invoice_number, invoice_cufe, invoice_pdf_url
//
// Opción B: Factura automática (modificar payments.controller)
//   En payments.controller.js → create(), al final del handler agregar:
//
//   // Auto-facturar si el tenant tiene billing configurado
//   const { rows: tRows } = await db.query(
//     'SELECT billing_provider FROM tenants WHERE id = $1', [req.tenantId]
//   );
//   if (tRows[0]?.billing_provider) {
//     const { generateInvoiceForPayment } = require('../billing/billing.controller');
//     // Fire-and-forget
//     generateInvoiceForPayment(rows[0].id, req.tenantId).catch(err => {
//       console.error('[Billing] Auto-factura falló:', err.message);
//     });
//   }


// ============================================================================
// 6. ENDPOINTS DISPONIBLES
// ============================================================================
//
// POST   /api/billing/invoice/:paymentId    — Genera factura electrónica
// GET    /api/billing/invoice/:paymentId     — Consulta estado de factura
// POST   /api/billing/retry/:paymentId       — Reintenta factura fallida
// POST   /api/billing/credit-note/:paymentId — Nota crédito (anulación)
// GET    /api/billing/invoices               — Lista facturas emitidas
// GET    /api/billing/config                 — Estado de config fiscal
// POST   /api/billing/config/test            — Prueba conexión con Alegra
// POST   /api/billing/sync-services          — Sincroniza servicios


// ============================================================================
// 7. CÓDIGO UNSPSC PARA LAVADEROS
// ============================================================================
// El código de producto DIAN (UNSPSC) para lavado de vehículos es:
//   78181500 - Servicios de lavado y limpieza de vehículos
//
// Este código ya está configurado por defecto en alegra.client.js.
// Si el lavadero ofrece otros servicios (ej: parqueadero), agregar
// los códigos correspondientes.


// ============================================================================
// 8. MANEJO DE ERRORES Y REINTENTOS
// ============================================================================
//
// Cuando una factura falla:
//   1. Se marca invoice_status = 'failed' en payments
//   2. Se registra en billing_errors con detalle
//   3. El admin puede reintentar: POST /api/billing/retry/:paymentId
//   4. Si falla 3+ veces, generar factura manualmente en Alegra
//
// Errores comunes de Alegra/DIAN:
//   - "NIT no válido": verificar NIT del cliente en customers
//   - "Resolución expirada": renovar resolución DIAN
//   - "Consecutivo duplicado": verificar numeración en Alegra
//   - "Producto sin código UNSPSC": agregar productKey en items


// ============================================================================
// 9. SANDBOX vs PRODUCCIÓN
// ============================================================================
//
// Alegra usa la MISMA URL para sandbox y producción.
// La diferencia es la CUENTA:
//   - Sandbox: crear cuenta de prueba en https://app.alegra.com
//   - Producción: cuenta real habilitada ante DIAN
//
// El código NO cambia entre sandbox y producción.
// Solo cambias las credenciales (billing_api_key) del tenant.


module.exports = {
  __doc: 'Guía de integración Fase 4 — Facturación Electrónica DIAN vía Alegra',
};
