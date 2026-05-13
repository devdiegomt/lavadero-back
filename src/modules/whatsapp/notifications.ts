/**
 * Notificaciones proactivas de WhatsApp.
 *
 * `sender.js` aún no se ha migrado a TS; se importa con un tipo explícito
 * para que este módulo compile correctamente.
 */

import * as db from '../../shared/db';
import { formatCOP } from '../../shared/utils/pricing';

// Interfaz mínima del sender (se actualizará cuando sender.js migre)
interface Sender {
  sendText(phone: string, message: string, tenantId: string, flowStep: string): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createSenderForTenant } = require('./sender') as {
  createSenderForTenant(tenantData: Record<string, unknown>): Promise<Sender>;
};

type AppointmentNotifyRow = {
  id: string; first_name: string; customer_phone: string | null;
  plate: string; brand: string | null; model: string | null;
  service_name: string; tenant_name: string; total_amount: number;
  whatsapp_enabled: boolean; whatsapp_provider: string | null; whatsapp_phone: string | null;
};

// ─── notifyVehicleReady ───────────────────────────────────────────────────────

export async function notifyVehicleReady(appointmentId: string, tenantId: string): Promise<void> {
  try {
    const { rows } = await db.query<AppointmentNotifyRow>(
      `SELECT a.*, c.first_name, c.phone AS customer_phone,
              v.plate, v.brand, v.model,
              s.name AS service_name,
              t.name AS tenant_name, t.whatsapp_enabled, t.whatsapp_provider, t.whatsapp_phone
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       JOIN vehicles  v ON v.id = a.vehicle_id
       JOIN services  s ON s.id = a.service_id
       JOIN tenants   t ON t.id = a.tenant_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [appointmentId, tenantId],
    );

    if (rows.length === 0 || !rows[0].whatsapp_enabled || !rows[0].customer_phone) return;

    const data = rows[0];
    // En este punto customer_phone está garantizado como no-null
    const customerPhone = data.customer_phone as string;
    const vehicleDesc = [data.brand, data.model].filter(Boolean).join(' ') || 'tu vehículo';
    const hora = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const message =
      `🚗 *¡Tu vehículo está listo!*\n\n` +
      `Hola ${data.first_name}, tu ${vehicleDesc} con placa *${data.plate}* ` +
      `ya está listo para recoger en ${data.tenant_name}.\n\n` +
      `Servicio: ${data.service_name}\nHora de finalización: ${hora}\n\n¡Te esperamos! 🧼`;

    const sender = await createSenderForTenant(data as unknown as Record<string, unknown>);
    await sender.sendText(customerPhone, message, tenantId, 'notification:vehicle_ready');
  } catch (err) {
    console.error('[WhatsApp Notifications] Error en notifyVehicleReady:', (err as Error).message);
  }
}

// ─── sendAppointmentReminders ─────────────────────────────────────────────────

type ReminderRow = AppointmentNotifyRow & {
  scheduled_time: string; tenant_id: string;
};

export async function sendAppointmentReminders(): Promise<void> {
  try {
    const { rows: appointments } = await db.query<ReminderRow>(
      `SELECT a.id, a.scheduled_time, a.tenant_id,
              c.first_name, c.phone AS customer_phone,
              v.plate, s.name AS service_name,
              t.name AS tenant_name, t.whatsapp_enabled, t.whatsapp_provider, t.whatsapp_phone,
              NULL::numeric AS total_amount, NULL AS brand, NULL AS model
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       JOIN vehicles  v ON v.id = a.vehicle_id
       JOIN services  s ON s.id = a.service_id
       JOIN tenants   t ON t.id = a.tenant_id
       WHERE a.scheduled_date = CURRENT_DATE
         AND a.status = 'pending' AND a.source = 'whatsapp'
         AND a.scheduled_time IS NOT NULL AND t.whatsapp_enabled = true
         AND a.scheduled_time BETWEEN
           (NOW() AT TIME ZONE t.timezone + INTERVAL '25 minutes')::time
           AND (NOW() AT TIME ZONE t.timezone + INTERVAL '35 minutes')::time
         AND NOT EXISTS (
           SELECT 1 FROM whatsapp_messages wm
           WHERE wm.tenant_id = a.tenant_id AND wm.phone = c.phone
             AND wm.flow_step = 'notification:reminder' AND wm.created_at > NOW() - INTERVAL '1 hour'
         )`,
    );

    for (const appt of appointments) {
      if (!appt.customer_phone) continue;
      const [h, m] = appt.scheduled_time.substring(0, 5).split(':').map(Number);
      const ampm   = h >= 12 ? 'PM' : 'AM';
      const h12    = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const timeStr = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;

      const message =
        `📋 *Recordatorio de tu cita*\n\n` +
        `Hola ${appt.first_name}, tienes una cita en *${appt.tenant_name}* hoy a las *${timeStr}*.\n\n` +
        `Servicio: ${appt.service_name}\nVehículo: ${appt.plate}\n\n` +
        `Si necesitas cancelar, escribe CANCELAR.\n¡Te esperamos! 🙌`;

      try {
        const sender = await createSenderForTenant(appt as unknown as Record<string, unknown>);
        await sender.sendText(appt.customer_phone, message, appt.tenant_id, 'notification:reminder');
      } catch (err) {
        console.error(`[WhatsApp Notifications] Error enviando reminder:`, (err as Error).message);
      }
    }

    if (appointments.length > 0) {
      console.log(`[WhatsApp Notifications] Enviados ${appointments.length} recordatorios`);
    }
  } catch (err) {
    console.error('[WhatsApp Notifications] Error en sendAppointmentReminders:', (err as Error).message);
  }
}

// ─── sendWelcomeMessage ───────────────────────────────────────────────────────

export async function sendWelcomeMessage(phone: string, firstName: string, tenantId: string): Promise<void> {
  try {
    const { rows } = await db.query(
      'SELECT * FROM tenants WHERE id = $1 AND whatsapp_enabled = true',
      [tenantId],
    );
    if (rows.length === 0) return;

    const tenant = rows[0] as Record<string, unknown>;
    const message =
      `👋 *¡Bienvenido a ${tenant['name']}!*\n\n` +
      `Hola ${firstName}, ahora puedes usar este chat para:\n\n` +
      `1️⃣ Consultar el estado de tu vehículo\n2️⃣ Agendar un turno\n3️⃣ Ver precios\n4️⃣ Ver tu historial\n\n` +
      `Escribe el número de la opción que necesites. 🚿`;

    const sender = await createSenderForTenant(tenant);
    await sender.sendText(phone, message, tenantId, 'notification:welcome');
  } catch (err) {
    console.error('[WhatsApp Notifications] Error en sendWelcomeMessage:', (err as Error).message);
  }
}

// Silenciar import no usado (formatCOP no se usa aquí pero puede usarse en plantillas futuras)
void formatCOP;