/**
 * Notificaciones proactivas de WhatsApp.
 * 
 * Envía mensajes automáticos cuando:
 * 1. Un turno cambia a estado "done" (listo) → notifica al cliente
 * 2. Se acerca la hora de una cita agendada → recordatorio 30 min antes
 * 3. Un cliente nuevo es registrado → mensaje de bienvenida
 * 
 * IMPORTANTE: Los mensajes proactivos fuera de la ventana de 24h
 * requieren plantillas aprobadas por WhatsApp Business API.
 * Dentro de la ventana de 24h se pueden enviar mensajes libres.
 */

const db = require('../../shared/db');
const { createSenderForTenant } = require('./sender');
const { formatCOP } = require('../../shared/utils/pricing');

/**
 * Notifica al cliente cuando su vehículo está listo.
 * Llamar desde el changeStatus del appointments controller.
 * 
 * @param {string} appointmentId - ID del turno
 * @param {string} tenantId - ID del tenant
 */
async function notifyVehicleReady(appointmentId, tenantId) {
  try {
    // Obtener datos del turno con cliente y vehículo
    const { rows } = await db.query(
      `SELECT a.*, c.first_name, c.phone as customer_phone,
              v.plate, v.brand, v.model,
              s.name as service_name,
              t.name as tenant_name, t.whatsapp_enabled, t.whatsapp_provider, t.whatsapp_phone
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       JOIN vehicles v ON v.id = a.vehicle_id
       JOIN services s ON s.id = a.service_id
       JOIN tenants t ON t.id = a.tenant_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [appointmentId, tenantId]
    );

    if (rows.length === 0) return;
    const data = rows[0];

    if (!data.whatsapp_enabled || !data.customer_phone) return;

    const vehicleDesc = [data.brand, data.model].filter(Boolean).join(' ') || 'tu vehículo';
    const hora = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

    const message = `🚗 *¡Tu vehículo está listo!*\n\nHola ${data.first_name}, tu ${vehicleDesc} con placa *${data.plate}* ya está listo para recoger en ${data.tenant_name}.\n\nServicio: ${data.service_name}\nHora de finalización: ${hora}\n\n¡Te esperamos! 🧼`;

    const sender = await createSenderForTenant(data);
    await sender.sendText(data.customer_phone, message, tenantId, 'notification:vehicle_ready');
  } catch (err) {
    console.error('[WhatsApp Notifications] Error en notifyVehicleReady:', err.message);
  }
}

/**
 * Envía recordatorios de citas próximas.
 * Ejecutar con un cron job cada 5 minutos.
 * 
 * Busca citas agendadas que empiezan en los próximos 25-35 minutos
 * que NO tengan recordatorio enviado ya.
 */
async function sendAppointmentReminders() {
  try {
    const { rows: appointments } = await db.query(
      `SELECT a.id, a.scheduled_time, a.tenant_id,
              c.first_name, c.phone as customer_phone,
              v.plate,
              s.name as service_name,
              t.name as tenant_name, t.whatsapp_enabled, t.whatsapp_provider, t.whatsapp_phone
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       JOIN vehicles v ON v.id = a.vehicle_id
       JOIN services s ON s.id = a.service_id
       JOIN tenants t ON t.id = a.tenant_id
       WHERE a.scheduled_date = CURRENT_DATE
         AND a.status = 'pending'
         AND a.source = 'whatsapp'
         AND a.scheduled_time IS NOT NULL
         AND t.whatsapp_enabled = true
         AND a.scheduled_time BETWEEN
           (NOW() AT TIME ZONE t.timezone + INTERVAL '25 minutes')::time
           AND
           (NOW() AT TIME ZONE t.timezone + INTERVAL '35 minutes')::time
         AND NOT EXISTS (
           SELECT 1 FROM whatsapp_messages wm
           WHERE wm.tenant_id = a.tenant_id
             AND wm.phone = c.phone
             AND wm.flow_step = 'notification:reminder'
             AND wm.created_at > NOW() - INTERVAL '1 hour'
         )`
    );

    for (const appt of appointments) {
      if (!appt.customer_phone) continue;

      const timeStr = appt.scheduled_time.substring(0, 5);
      const hour = parseInt(timeStr.split(':')[0]);
      const min = timeStr.split(':')[1];
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      const formattedTime = `${h12}:${min} ${ampm}`;

      const message = `📋 *Recordatorio de tu cita*\n\nHola ${appt.first_name}, te recordamos que tienes una cita en *${appt.tenant_name}* hoy a las *${formattedTime}*.\n\nServicio: ${appt.service_name}\nVehículo: ${appt.plate}\n\nSi necesitas cancelar, escribe CANCELAR.\n¡Te esperamos! 🙌`;

      try {
        const sender = await createSenderForTenant(appt);
        await sender.sendText(appt.customer_phone, message, appt.tenant_id, 'notification:reminder');
      } catch (err) {
        console.error(`[WhatsApp Notifications] Error enviando reminder a ${appt.customer_phone}:`, err.message);
      }
    }

    if (appointments.length > 0) {
      console.log(`[WhatsApp Notifications] Enviados ${appointments.length} recordatorios`);
    }
  } catch (err) {
    console.error('[WhatsApp Notifications] Error en sendAppointmentReminders:', err.message);
  }
}

/**
 * Envía mensaje de bienvenida a un cliente nuevo.
 * Llamar cuando se registra un cliente con número de teléfono.
 * 
 * @param {string} phone - Teléfono del cliente
 * @param {string} firstName - Nombre del cliente
 * @param {string} tenantId - ID del tenant
 */
async function sendWelcomeMessage(phone, firstName, tenantId) {
  try {
    const { rows } = await db.query(
      'SELECT * FROM tenants WHERE id = $1 AND whatsapp_enabled = true',
      [tenantId]
    );
    if (rows.length === 0) return;

    const tenant = rows[0];

    const message = `👋 *¡Bienvenido a ${tenant.name}!*\n\nHola ${firstName}, ahora puedes usar este chat para:\n\n1️⃣ Consultar el estado de tu vehículo\n2️⃣ Agendar un turno\n3️⃣ Ver precios\n4️⃣ Ver tu historial\n\nEscribe el número de la opción que necesites. 🚿`;

    const sender = await createSenderForTenant(tenant);
    await sender.sendText(phone, message, tenantId, 'notification:welcome');
  } catch (err) {
    console.error('[WhatsApp Notifications] Error en sendWelcomeMessage:', err.message);
  }
}

module.exports = {
  notifyVehicleReady,
  sendAppointmentReminders,
  sendWelcomeMessage,
};
