/**
 * WhatsApp Controller
 * 
 * Recibe mensajes del webhook (Twilio/360dialog), identifica tenant,
 * carga/crea sesión, despacha al flujo correcto, y envía respuestas.
 */

const db = require('../../shared/db');
const { SessionManager } = require('./session');
const { createSenderForTenant } = require('./sender');

// Flujos disponibles
const menuFlow = require('./flows/menu');
const statusFlow = require('./flows/status');
const bookingFlow = require('./flows/booking');
const pricesFlow = require('./flows/prices');
const historyFlow = require('./flows/history');

const FLOWS = {
  menu: menuFlow,
  status: statusFlow,
  booking: bookingFlow,
  prices: pricesFlow,
  history: historyFlow,
};

let sessionManager = null;

/**
 * Inicializa el session manager con la instancia de Redis.
 * Llamar una vez al arrancar el server.
 */
function initWhatsApp(redis) {
  sessionManager = new SessionManager(redis);
}

// ---------------------------------------------------------------------------
// POST /api/whatsapp/webhook
// Recibe mensajes entrantes del proveedor de WhatsApp.
// ---------------------------------------------------------------------------
async function handleIncoming(req, res) {
  // Responder 200 inmediatamente (WhatsApp API espera respuesta rápida)
  res.status(200).json({ status: 'received' });

  try {
    // Extraer datos según proveedor
    const { phone, text, tenantPhone } = extractMessageData(req);

    if (!phone || !text || !tenantPhone) {
      console.warn('[WhatsApp] Mensaje incompleto, ignorando.');
      return;
    }

    // Sanitizar input
    const sanitizedText = sanitize(text);
    if (!sanitizedText) return;

    // Identificar tenant por número de WhatsApp receptor
    const tenant = await getTenantByPhone(tenantPhone);
    if (!tenant) {
      console.warn(`[WhatsApp] Tenant no encontrado para número: ${tenantPhone}`);
      return;
    }

    if (!tenant.whatsapp_enabled) {
      console.warn(`[WhatsApp] WhatsApp deshabilitado para tenant: ${tenant.slug}`);
      return;
    }

    // Rate limiting por teléfono
    const rateLimitOk = await checkRateLimit(phone, tenant.id);
    if (!rateLimitOk) {
      console.warn(`[WhatsApp] Rate limit excedido para: ${phone}`);
      return;
    }

    // Log del mensaje entrante
    await logIncomingMessage(tenant.id, phone, sanitizedText);

    // Buscar cliente existente
    const customer = await findCustomerByPhone(phone, tenant.id);

    // Cargar sesión de Redis
    let session = await sessionManager.get(tenant.id, phone);

    // Atajo global: "0" siempre vuelve al menú
    if (sanitizedText === '0' || sanitizedText.toLowerCase() === 'menu' || sanitizedText.toLowerCase() === 'volver') {
      await sessionManager.delete(tenant.id, phone);
      session = null;
    }

    // Atajo: "AYUDA" marca para revisión humana
    if (sanitizedText.toLowerCase() === 'ayuda') {
      await handleHumanRequest(tenant, phone, customer);
      return;
    }

    // Determinar flujo a ejecutar
    let flow;
    if (!session || !session.flow || session.flow === 'idle') {
      // Sin sesión activa → menú
      flow = FLOWS.menu;
    } else if (session.step === 'init') {
      // El menú ya determinó el siguiente flujo
      flow = FLOWS[session.flow];
    } else {
      // Sesión activa, continuar en el flujo actual
      flow = FLOWS[session.flow];
    }

    if (!flow) {
      flow = FLOWS.menu;
      await sessionManager.delete(tenant.id, phone);
      session = null;
    }

    // Ejecutar flujo
    const ctx = {
      text: sanitizedText,
      session,
      tenant,
      customer,
      phone,
    };

    const result = await flow.handle(ctx);

    // Si el flujo retorna un dispatch a otro flujo (ej: menú → status)
    if (result.messages.length === 0 && result.nextFlow && result.nextStep === 'init') {
      // Despachar inmediatamente al nuevo flujo
      const newFlow = FLOWS[result.nextFlow];
      if (newFlow) {
        const initResult = await newFlow.handle({
          ...ctx,
          session: { flow: result.nextFlow, step: 'init', data: {}, retries: 0 },
        });

        // Guardar sesión del nuevo flujo
        if (initResult.nextFlow) {
          await sessionManager.create(tenant.id, phone, initResult.nextFlow, initResult.nextStep, initResult.data || {});
        } else {
          await sessionManager.delete(tenant.id, phone);
        }

        // Enviar mensajes
        const sender = await createSenderForTenant(tenant);
        for (const msg of initResult.messages) {
          await sender.sendText(phone, msg, tenant.id, `${result.nextFlow}:${initResult.nextStep}`);
        }
        return;
      }
    }

    // Manejar retries
    if (result.retry) {
      const exceeded = await sessionManager.incrementRetries(tenant.id, phone);
      if (exceeded) {
        // Demasiados reintentos, reset
        await sessionManager.delete(tenant.id, phone);
        const sender = await createSenderForTenant(tenant);
        await sender.sendText(
          phone,
          `😅 Parece que no estamos entendiéndonos.\n\nVoy a reiniciar la conversación. Escribe *Hola* para empezar de nuevo.\n\nSi necesitas ayuda de una persona, escribe *AYUDA*.`,
          tenant.id,
          'fallback:max_retries'
        );
        return;
      }
    }

    // Actualizar sesión
    if (result.nextFlow) {
      await sessionManager.create(tenant.id, phone, result.nextFlow, result.nextStep, result.data || {});
    } else {
      await sessionManager.delete(tenant.id, phone);
    }

    // Enviar mensajes de respuesta
    const sender = await createSenderForTenant(tenant);
    for (const msg of result.messages) {
      await sender.sendText(phone, msg, tenant.id, `${result.nextFlow || 'done'}:${result.nextStep || 'done'}`);
    }
  } catch (err) {
    console.error('[WhatsApp] Error procesando mensaje:', err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/whatsapp/webhook
// Verificación del webhook (handshake con Twilio/360dialog/Meta).
// ---------------------------------------------------------------------------
async function verifyWebhook(req, res) {
  // Meta / 360dialog verification
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  // Twilio no usa GET para verificación
  res.status(403).json({ error: 'Verificación fallida' });
}

// ---------------------------------------------------------------------------
// GET /api/whatsapp/messages?page=1&limit=50
// Panel admin: ver mensajes recientes (solo lectura).
// ---------------------------------------------------------------------------
async function listMessages(req, res) {
  const { page = 1, limit = 50, phone } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [req.tenantId];
  let where = 'tenant_id = $1';

  if (phone) {
    params.push(`%${phone}%`);
    where += ` AND phone ILIKE $${params.length}`;
  }

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) FROM whatsapp_messages WHERE ${where}`, params
  );

  params.push(parseInt(limit), offset);
  const { rows } = await db.query(
    `SELECT * FROM whatsapp_messages
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    data: rows,
    pagination: {
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/whatsapp/conversations
// Panel admin: conversaciones activas agrupadas por teléfono.
// ---------------------------------------------------------------------------
async function listConversations(req, res) {
  const { rows } = await db.query(
    `SELECT
       phone,
       COUNT(*) as message_count,
       MAX(created_at) as last_message_at,
       COUNT(*) FILTER (WHERE direction = 'inbound') as inbound_count,
       COUNT(*) FILTER (WHERE direction = 'outbound') as outbound_count
     FROM whatsapp_messages
     WHERE tenant_id = $1
       AND created_at > NOW() - INTERVAL '7 days'
     GROUP BY phone
     ORDER BY MAX(created_at) DESC
     LIMIT 50`,
    [req.tenantId]
  );

  res.json(rows);
}

// ---------------------------------------------------------------------------
// GET /api/whatsapp/stats
// Estadísticas del bot para el dashboard.
// ---------------------------------------------------------------------------
async function getStats(req, res) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) as total_messages,
       COUNT(*) FILTER (WHERE direction = 'inbound') as inbound,
       COUNT(*) FILTER (WHERE direction = 'outbound') as outbound,
       COUNT(DISTINCT phone) as unique_contacts,
       COUNT(*) FILTER (WHERE flow_step LIKE 'booking:%') as booking_interactions,
       COUNT(*) FILTER (WHERE flow_step = 'done:done' AND content LIKE '%agendado%') as bookings_completed
     FROM whatsapp_messages
     WHERE tenant_id = $1
       AND created_at > NOW() - INTERVAL '30 days'`,
    [req.tenantId]
  );

  // Turnos creados por WhatsApp
  const { rows: waAppointments } = await db.query(
    `SELECT COUNT(*) as count
     FROM appointments
     WHERE tenant_id = $1 AND source = 'whatsapp'
       AND created_at > NOW() - INTERVAL '30 days'`,
    [req.tenantId]
  );

  res.json({
    ...rows[0],
    whatsapp_appointments: parseInt(waAppointments[0].count),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extrae datos del mensaje según el proveedor.
 */
function extractMessageData(req) {
  const body = req.body;

  // Twilio format
  if (body.From && body.Body) {
    return {
      phone: body.From.replace('whatsapp:', ''),
      text: body.Body,
      tenantPhone: body.To?.replace('whatsapp:', ''),
    };
  }

  // 360dialog / Meta Cloud API format
  if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const change = body.entry[0].changes[0].value;
    const msg = change.messages[0];
    return {
      phone: '+' + msg.from,
      text: msg.text?.body || '',
      tenantPhone: '+' + change.metadata?.display_phone_number?.replace(/\D/g, ''),
    };
  }

  return { phone: null, text: null, tenantPhone: null };
}

/**
 * Sanitiza el texto del mensaje.
 */
function sanitize(text) {
  if (!text || typeof text !== 'string') return '';
  // Strip HTML, limitar longitud
  return text.replace(/<[^>]*>/g, '').trim().substring(0, 500);
}

/**
 * Busca el tenant por número de WhatsApp.
 */
async function getTenantByPhone(phone) {
  // Normalizar número
  const normalized = phone.replace(/[\s\-\(\)]/g, '');
  const { rows } = await db.query(
    `SELECT * FROM tenants
     WHERE whatsapp_phone = $1 AND is_active = true
     LIMIT 1`,
    [normalized]
  );
  return rows[0] || null;
}

/**
 * Busca cliente por teléfono dentro de un tenant.
 */
async function findCustomerByPhone(phone, tenantId) {
  const { rows } = await db.query(
    `SELECT id, first_name, last_name, phone, visit_count
     FROM customers
     WHERE phone = $1 AND tenant_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [phone, tenantId]
  );
  return rows[0] || null;
}

/**
 * Rate limiting por teléfono usando Redis.
 * Máximo 20 mensajes por minuto.
 */
async function checkRateLimit(phone, tenantId) {
  if (!sessionManager?.redis) return true; // Sin Redis, no limitar

  const key = `wa:rate:${tenantId}:${phone}`;
  const count = await sessionManager.redis.incr(key);
  if (count === 1) {
    await sessionManager.redis.expire(key, 60);
  }
  return count <= 20;
}

/**
 * Log de mensaje entrante.
 */
async function logIncomingMessage(tenantId, phone, text) {
  try {
    await db.query(
      `INSERT INTO whatsapp_messages
        (tenant_id, phone, direction, message_type, content)
       VALUES ($1, $2, 'inbound', 'text', $3)`,
      [tenantId, phone, text]
    );
  } catch (err) {
    console.error('[WhatsApp] Error logging incoming:', err.message);
  }
}

/**
 * Maneja solicitud de ayuda humana.
 */
async function handleHumanRequest(tenant, phone, customer) {
  const sender = await createSenderForTenant(tenant);
  await sender.sendText(
    phone,
    `🙋 *Solicitud de ayuda recibida*\n\nUn asesor de ${tenant.name} te contactará pronto.\n\nHorario de atención: Lun-Sáb ${tenant.opening_time}-${tenant.closing_time}\n\nGracias por tu paciencia. 🙏`,
    tenant.id,
    'help:human_request'
  );

  // Marcar para revisión en la BD (se puede extender con un sistema de tickets)
  await db.query(
    `INSERT INTO whatsapp_messages
      (tenant_id, phone, direction, message_type, content, flow_step, status)
     VALUES ($1, $2, 'system', 'flag', 'HUMAN_HELP_REQUESTED', 'help:flagged', 'needs_review')`,
    [tenant.id, phone]
  );
}

module.exports = {
  initWhatsApp,
  handleIncoming,
  verifyWebhook,
  listMessages,
  listConversations,
  getStats,
};
