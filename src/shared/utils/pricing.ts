/**
 * Utilidades para precios en COP.
 *
 * Convención: los precios se almacenan como INTEGER en centavos en la BD.
 * $25.000 COP = 2_500_000 centavos.
 *
 * El frontend recibe centavos y los convierte a pesos para mostrar.
 */

import type { VehicleType, ServiceRow } from '../../types/entities';

/** Mapa de tipo de vehículo → columna de precio en ServiceRow */
const PRICE_COLUMN: Record<VehicleType, keyof ServiceRow> = {
  sedan:     'price_sedan',
  suv:       'price_suv',
  camioneta: 'price_camioneta',
  moto:      'price_moto',
  pickup:    'price_pickup',
};

/**
 * Obtiene el precio correcto del servicio según el tipo de vehículo.
 * Hace fallback a `price_sedan` si el tipo no existe en el servicio.
 *
 * @returns Precio en centavos
 */
export function getServicePrice(service: ServiceRow, vehicleType: VehicleType): number {
  const col = PRICE_COLUMN[vehicleType];
  const price = service[col];
  return typeof price === 'number' ? price : service.price_sedan ?? 0;
}

/**
 * Convierte centavos a pesos (divide por 100).
 * 2_500_000 → 25_000
 */
export function centsToPesos(centavos: number): number {
  return Math.round(centavos / 100);
}

/**
 * Convierte pesos a centavos (multiplica por 100).
 * 25_000 → 2_500_000
 */
export function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100);
}

/**
 * Formatea centavos como string COP legible.
 * 2_500_000 → "$25.000"
 */
export function formatCOP(centavos: number): string {
  return '$' + centsToPesos(centavos).toLocaleString('es-CO');
}