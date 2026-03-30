/**
 * Flujo: Mi Historial de Lavados
 * 
 * Busca al cliente por número de teléfono y muestra sus últimos lavados.
 */

const db = require('../../../shared/db');
const { formatCOP } = require('../../../shared/utils/pricing');

const STATUS_LABEL = {
  pending: '⏳',
  in_progress: '🔵',
  done: '🟢',
  delivered: '✅',
  cancelled: '❌',
};

async function handle(ctx) {
  const { tenant, phone } = ctx;

  // Buscar cliente por teléfono
  const { rows: customers } = await db.query(
    `SELECT id, first_name FROM customers
     WHERE phone = $1 AND tenant_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [phone, tenant.id]
  );

  if (customers.length === 0) {
    return {
      messages: [
        `😕 No encontramos tu número en nuestro sistema.\n\nSi es tu primera visita, acércate directamente al lavadero y te registraremos.\n\n_Escribe 0 para volver al menú._`,
      ],
      nextFlow: null,
      nextStep: null,
      data: {},
    };
  }

  const customerId = customers[0].id;
  const customerName = customers[0].first_name;

  // Últimos 5 servicios
  const { rows: history } = await db.query(
    `SELECT a.scheduled_date, a.status, a.price,
            s.name as service_name,
            v.plate
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     JOIN vehicles v ON v.id = a.vehicle_id
     WHERE a.customer_id = $1
       AND a.status IN ('delivered', 'done', 'in_progress', 'pending')
     ORDER BY a.scheduled_date DESC, a.created_at DESC
     LIMIT 5`,
    [customerId]
  );

  // Estadísticas
  const { rows: stats } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'delivered') as total_visits,
       COALESCE(SUM(p.amount), 0) as total_spent
     FROM appointments a
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.customer_id = $1`,
    [customerId]
  );

  // Servicio favorito
  const { rows: favRows } = await db.query(
    `SELECT s.name, COUNT(*) as cnt
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     WHERE a.customer_id = $1 AND a.status = 'delivered'
     GROUP BY s.name
     ORDER BY cnt DESC
     LIMIT 1`,
    [customerId]
  );

  if (history.length === 0) {
    return {
      messages: [
        `📊 Hola *${customerName}*, aún no tienes lavados registrados.\n\n¿Quieres agendar tu primer turno? Escribe *2*\n_Escribe 0 para volver al menú._`,
      ],
      nextFlow: null,
      nextStep: null,
      data: {},
    };
  }

  // Formatear historial
  const historyList = history.map((h, i) => {
    const date = new Date(h.scheduled_date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
    const emoji = STATUS_LABEL[h.status] || '❓';
    return `${i + 1}. 📅 ${date} — ${h.plate}\n   ${h.service_name} — ${formatCOP(h.price)} ${emoji}`;
  }).join('\n\n');

  const totalVisits = parseInt(stats[0].total_visits) || 0;
  const totalSpent = parseInt(stats[0].total_spent) || 0;
  const favoriteService = favRows[0]?.name || 'N/A';

  const msg = `📊 *Tu historial de lavados, ${customerName}:*\n\n${historyList}\n\n📈 *Resumen:*\nVisitas completadas: ${totalVisits}\nGasto total: ${formatCOP(totalSpent)}\nServicio favorito: ${favoriteService}\n\n_Escribe 0 para volver al menú._`;

  return {
    messages: [msg],
    nextFlow: null,
    nextStep: null,
    data: {},
  };
}

module.exports = { handle };
