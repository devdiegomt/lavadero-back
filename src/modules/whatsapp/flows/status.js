/**
 * Flujo: Consultar Estado del Vehículo
 * 
 * Steps:
 *   init → awaiting_plate → (respuesta) → done
 */

const db = require('../../../shared/db');
const { formatCOP } = require('../../../shared/utils/pricing');
const { getTenantToday } = require('../../../shared/utils/dateUtils');

const STATUS_EMOJI = {
  pending: '🟡 Esperando',
  in_progress: '🔵 En Lavado',
  done: '🟢 Listo para recoger',
  delivered: '✅ Entregado',
};

async function handle(ctx) {
  const { text, session, tenant } = ctx;
  const step = session?.step || 'init';

  if (step === 'init') {
    return {
      messages: [
        `🔍 *Consultar estado*\n\nPor favor, escribe la *placa* de tu vehículo.\n\nEjemplo: ABC123`,
      ],
      nextFlow: 'status',
      nextStep: 'awaiting_plate',
      data: {},
    };
  }

  if (step === 'awaiting_plate') {
    const plate = text.trim().toUpperCase().replace(/[\s-]/g, '');

    // Validar formato de placa colombiana (3 letras + 3 números, o motos: 3 letras + 2 números + 1 letra)
    if (!/^[A-Z]{3}\d{2,3}[A-Z]?$/.test(plate)) {
      return {
        messages: [
          `❌ Eso no parece una placa válida.\n\nEscribe la placa sin espacios ni guiones.\nEjemplo: *ABC123* o *ZXY12A*\n\n_Escribe 0 para volver al menú._`,
        ],
        nextFlow: 'status',
        nextStep: 'awaiting_plate',
        data: {},
        retry: true,
      };
    }

    // Buscar turno activo para esta placa hoy
    const todayDate = await getTenantToday(tenant.id);

    const { rows } = await db.query(
      `SELECT a.*, s.name as service_name, s.estimated_minutes,
              v.plate, v.brand, v.model, v.color, v.vehicle_type,
              EXTRACT(EPOCH FROM (NOW() - a.started_at)) / 60 as minutes_elapsed
       FROM appointments a
       JOIN vehicles v ON v.id = a.vehicle_id
       JOIN services s ON s.id = a.service_id
       WHERE UPPER(v.plate) = $1
         AND a.tenant_id = $2
         AND a.scheduled_date = $3
         AND a.status NOT IN ('cancelled', 'delivered')
       ORDER BY a.created_at DESC
       LIMIT 1`,
      [plate, tenant.id, todayDate]
    );

    if (rows.length === 0) {
      // Buscar si la placa existe en el sistema
      const { rows: vehicleRows } = await db.query(
        `SELECT id FROM vehicles WHERE UPPER(plate) = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [plate, tenant.id]
      );

      const notFoundMsg = vehicleRows.length > 0
        ? `😕 No encontramos un turno activo para la placa *${plate}* hoy.\n\nSi acabas de llegar, es posible que aún no hayan registrado tu vehículo en el sistema.\n\n¿Quieres agendar un turno? Escribe *2*\n_Escribe 0 para volver al menú._`
        : `😕 No encontramos la placa *${plate}* en nuestro sistema.\n\nSi es tu primera visita, acércate directamente al lavadero y te registraremos.\n\n_Escribe 0 para volver al menú._`;

      return {
        messages: [notFoundMsg],
        nextFlow: null, // Flujo completado
        nextStep: null,
        data: {},
      };
    }

    const appt = rows[0];
    const statusText = STATUS_EMOJI[appt.status] || appt.status;
    const vehicleInfo = [appt.brand, appt.model, appt.color].filter(Boolean).join(' ');

    // Calcular tiempo restante estimado
    let timeInfo = '';
    if (appt.status === 'in_progress' && appt.minutes_elapsed != null) {
      const elapsed = Math.round(parseFloat(appt.minutes_elapsed));
      const remaining = Math.max(0, appt.estimated_minutes - elapsed);
      timeInfo = remaining > 0
        ? `\n⏱️ Tiempo estimado restante: ~${remaining} min`
        : `\n⏱️ Ya debería estar casi listo`;
    } else if (appt.status === 'pending') {
      timeInfo = `\n⏱️ Duración estimada del servicio: ~${appt.estimated_minutes} min`;
    } else if (appt.status === 'done') {
      timeInfo = `\n🎉 ¡Ya puedes pasar a recogerlo!`;
    }

    const msg = `🚗 *Estado de tu vehículo:*\n\nPlaca: *${plate}*${vehicleInfo ? `\nVehículo: ${vehicleInfo}` : ''}\nServicio: ${appt.service_name}\nEstado: ${statusText}${timeInfo}\n\nTe notificaremos por aquí cuando esté listo. ✅\n\n_Escribe 0 para volver al menú._`;

    return {
      messages: [msg],
      nextFlow: null, // Flujo completado
      nextStep: null,
      data: { plate },
    };
  }

  // Fallback
  return {
    messages: ['Escribe la *placa* de tu vehículo o *0* para volver al menú.'],
    nextFlow: 'status',
    nextStep: 'awaiting_plate',
    data: session?.data || {},
    retry: true,
  };
}

module.exports = { handle };
