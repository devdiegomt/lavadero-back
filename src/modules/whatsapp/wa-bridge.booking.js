/**
 * wa-bridge.booking.js
 *
 * Agendamiento conversacional para el flujo de n8n.
 *
 * Agendar necesita varios turnos de conversacion (placa → servicio → horario →
 * confirmar) y n8n no guarda estado entre webhooks. En vez de reimplementar
 * esos pasos como nodos, este endpoint reutiliza flows/booking.js —que ya
 * resuelve disponibilidad segun horario y bahias del tenant, precios por tipo
 * de vehiculo y alta de clientes nuevos— y guarda el avance en Redis.
 *
 *   POST /api/wa-bridge/booking-step
 *   Body: { phone, message, start }
 *
 *   start:true  arranca el flujo (lo dispara el intent book_appointment).
 *   start:false continua una conversacion en curso; si no hay ninguna
 *               responde { active:false } y n8n sigue con la clasificacion.
 */

const db = require('../../shared/db');
const bookingFlow = require('./flows/booking');
const { SessionManager } = require('./session');

let sessionManager = null;

/**
 * Inyecta el cliente de Redis. Se llama una vez al arrancar el server.
 */
function initBooking(redis) {
  sessionManager = new SessionManager(redis);
}

/**
 * Palabras con las que el cliente aborta el flujo en cualquier paso.
 */
const CANCEL_WORDS = ['0', 'menu', 'menú', 'cancelar', 'salir'];

async function bookingStep(req, res) {
  const { phone, message, start } = req.body;
  const tenantId = req.tenantId;

  if (!phone) {
    return res.status(400).json({ error: 'phone es requerido' });
  }

  // Sin Redis no hay forma de recordar el paso: mejor decirlo que fallar raro.
  if (!sessionManager) {
    return res
      .status(503)
      .json({ error: 'Agendamiento no disponible: Redis no inicializado' });
  }

  const text = String(message || '').trim();
  const session = await sessionManager.get(tenantId, phone);

  // Nada que continuar: que n8n siga con la deteccion de intencion.
  if (!session && !start) {
    return res.json({ active: false });
  }

  // Salir del flujo en cualquier paso.
  if (session && CANCEL_WORDS.includes(text.toLowerCase())) {
    await sessionManager.delete(tenantId, phone);
    return res.json({
      active: true,
      done: true,
      reply: 'Listo, cancelé el agendamiento. ¿En qué más te ayudo? 😊',
    });
  }

  const { rows: tenants } = await db.query(
    `SELECT id, name, opening_time, closing_time, bays_count
     FROM tenants WHERE id = $1 LIMIT 1`,
    [tenantId]
  );
  if (!tenants[0]) {
    return res.status(404).json({ error: 'Tenant no encontrado' });
  }

  try {
    const result = await bookingFlow.handle({
      text,
      phone,
      tenant: tenants[0],
      // En el arranque no hay sesion: step 'init' pide la placa.
      session: session || { flow: 'booking', step: 'init', data: {}, retries: 0 },
    });

    // nextFlow null significa que el flujo termino (agendado o cancelado).
    if (result.nextFlow) {
      await sessionManager.set(tenantId, phone, {
        flow: result.nextFlow,
        step: result.nextStep,
        data: result.data || {},
        retries: result.retry ? (session?.retries || 0) + 1 : 0,
        createdAt: session?.createdAt || new Date().toISOString(),
      });
    } else {
      await sessionManager.delete(tenantId, phone);
    }

    return res.json({
      active: true,
      done: !result.nextFlow,
      step: result.nextStep || null,
      reply: (result.messages || []).join('\n\n'),
    });
  } catch (err) {
    // Un error a mitad del flujo dejaria la sesion en un paso irrecuperable.
    console.error('[wa-bridge] Error en bookingStep:', err.message);
    await sessionManager.delete(tenantId, phone);
    return res.status(500).json({
      active: true,
      done: true,
      error: 'Error en el agendamiento',
      reply:
        'Uy, se me cruzaron los cables agendando. ¿Lo intentamos de nuevo? 🙏',
    });
  }
}

module.exports = { initBooking, bookingStep };
