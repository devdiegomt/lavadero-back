/**
 * Flujo: Consultar Precios
 * 
 * Flujo de un solo paso. Muestra servicios activos con precios por tipo de vehículo.
 */

const db = require('../../../shared/db');
const { formatCOP } = require('../../../shared/utils/pricing');

async function handle(ctx) {
  const { tenant } = ctx;

  const { rows: services } = await db.query(
    'SELECT * FROM services WHERE tenant_id = $1 AND is_active = true ORDER BY sort_order, name',
    [tenant.id]
  );

  if (services.length === 0) {
    return {
      messages: [
        `😕 No hay servicios configurados en este momento.\n\nPor favor contacta al lavadero directamente.\n\n_Escribe 0 para volver al menú._`,
      ],
      nextFlow: null,
      nextStep: null,
      data: {},
    };
  }

  const EMOJIS = ['🧼', '✨', '🔮', '💎', '🚿', '🌟', '⭐', '🏆'];

  const serviceList = services.map((s, i) => {
    const emoji = EMOJIS[i % EMOJIS.length];
    const prices = [];

    if (s.price_sedan > 0) prices.push(`Sedán ${formatCOP(s.price_sedan)}`);
    if (s.price_suv > 0) prices.push(`SUV ${formatCOP(s.price_suv)}`);
    if (s.price_camioneta > 0 && s.price_camioneta !== s.price_suv) prices.push(`Camioneta ${formatCOP(s.price_camioneta)}`);
    if (s.price_moto > 0) prices.push(`Moto ${formatCOP(s.price_moto)}`);
    if (s.price_pickup > 0 && s.price_pickup !== s.price_suv) prices.push(`Pickup ${formatCOP(s.price_pickup)}`);

    const priceStr = prices.join(' | ');
    const timeStr = s.estimated_minutes ? ` (~${s.estimated_minutes} min)` : '';

    return `${emoji} *${s.name}*${timeStr}\n   ${priceStr}`;
  }).join('\n\n');

  return {
    messages: [
      `💰 *Nuestros servicios y precios:*\n\n${serviceList}\n\n¿Quieres agendar? Escribe *2*\n_Escribe 0 para volver al menú._`,
    ],
    nextFlow: null,
    nextStep: null,
    data: {},
  };
}

module.exports = { handle };
