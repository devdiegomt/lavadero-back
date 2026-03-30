/**
 * Utilidades para formateo de precios en COP.
 * Los precios se almacenan en centavos (INTEGER) en la DB.
 * $25.000 COP = 2500000 centavos
 */

/**
 * Convierte centavos a pesos para mostrar.
 * 2500000 → 25000
 */
function centsToPesos(centavos) {
  return Math.round(centavos / 100);
}

/**
 * Convierte pesos a centavos para almacenar.
 * 25000 → 2500000
 */
function pesosToCents(pesos) {
  return Math.round(pesos * 100);
}

/**
 * Formatea centavos como string COP legible.
 * 2500000 → "$25.000"
 */
function formatCOP(centavos) {
  const pesos = centsToPesos(centavos);
  return '$' + pesos.toLocaleString('es-CO');
}

/**
 * Obtiene el precio correcto según tipo de vehículo.
 * @param {Object} service - Servicio con price_sedan, price_suv, etc.
 * @param {string} vehicleType - 'sedan', 'suv', 'camioneta', 'moto', 'pickup'
 * @returns {number} Precio en centavos
 */
function getServicePrice(service, vehicleType) {
  const key = `price_${vehicleType}`;
  return service[key] || service.price_sedan || 0;
}

module.exports = { centsToPesos, pesosToCents, formatCOP, getServicePrice };
