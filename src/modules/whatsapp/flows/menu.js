/**
 * Flujo: Menú Principal
 * 
 * Punto de entrada para todas las interacciones.
 * Muestra las opciones disponibles y despacha al flujo correspondiente.
 */

const MENU_MESSAGE = `👋 *¡Hola{{nombre}}! Bienvenido a {{lavadero}}*

¿En qué te podemos ayudar?

1️⃣ Consultar estado de tu vehículo
2️⃣ Agendar un turno
3️⃣ Ver precios
4️⃣ Mi historial de lavados

Escribe el *número* de la opción.`;

/**
 * @param {object} ctx - Contexto del mensaje
 * @param {string} ctx.text - Texto del mensaje del usuario
 * @param {object} ctx.session - Sesión actual (puede ser null)
 * @param {object} ctx.tenant - Datos del tenant
 * @param {object} ctx.customer - Datos del cliente (puede ser null)
 * @returns {object} { messages: string[], nextFlow: string|null, nextStep: string|null, data: object }
 */
async function handle(ctx) {
  const { text, tenant, customer } = ctx;
  const t = text.trim().toLowerCase();

  // Personalizar saludo si conocemos al cliente
  const nombre = customer?.first_name ? `, ${customer.first_name}` : '';
  const menuMsg = MENU_MESSAGE
    .replace('{{nombre}}', nombre)
    .replace('{{lavadero}}', tenant.name);

  // Parsear opción
  const optionMap = {
    '1': 'status', 'estado': 'status', 'como va': 'status', 'mi carro': 'status',
    '2': 'booking', 'agendar': 'booking', 'cita': 'booking', 'reservar': 'booking', 'turno': 'booking',
    '3': 'prices', 'precios': 'prices', 'precio': 'prices', 'cuanto cuesta': 'prices', 'tarifas': 'prices',
    '4': 'history', 'historial': 'history', 'mis lavados': 'history', 'visitas': 'history',
  };

  const nextFlow = optionMap[t];

  if (nextFlow) {
    // Despachar al flujo seleccionado
    return {
      messages: [],
      nextFlow,
      nextStep: 'init',
      data: {},
    };
  }

  // Si no es opción válida, mostrar menú
  return {
    messages: [menuMsg],
    nextFlow: 'menu',
    nextStep: 'awaiting_option',
    data: {},
  };
}

module.exports = { handle };
