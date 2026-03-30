/**
 * Abstracción para enviar mensajes de WhatsApp.
 * Soporta Twilio y 360dialog como proveedores.
 * 
 * Cambiar de proveedor = cambiar este archivo solamente.
 */

const db = require('../../shared/db');

class WhatsAppSender {
  constructor(provider, config) {
    this.provider = provider; // 'twilio' | '360dialog'
    this.config = config;

    if (provider === 'twilio') {
      const twilio = require('twilio');
      this.client = twilio(config.accountSid, config.authToken);
    }
    // 360dialog usa HTTP directo
  }

  /**
   * Envía un mensaje de texto simple.
   * @param {string} to - Número destino con código país (ej: +573101234567)
   * @param {string} body - Texto del mensaje (soporta formato WhatsApp: *bold*, _italic_)
   * @param {string} tenantId - ID del tenant
   * @param {string} [flowStep] - Paso del flujo (para logging)
   */
  async sendText(to, body, tenantId, flowStep = null) {
    let externalId = null;

    try {
      if (this.provider === 'twilio') {
        const msg = await this.client.messages.create({
          from: `whatsapp:${this.config.fromNumber}`,
          to: `whatsapp:${to}`,
          body,
        });
        externalId = msg.sid;
      } else if (this.provider === '360dialog') {
        const response = await fetch('https://waba.360dialog.io/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'D360-API-KEY': this.config.apiKey,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: to.replace('+', ''),
            type: 'text',
            text: { body },
          }),
        });
        const data = await response.json();
        externalId = data.messages?.[0]?.id || null;
      }

      // Log en base de datos
      await this._logMessage(tenantId, to, 'outbound', 'text', body, flowStep, externalId, 'sent');
    } catch (err) {
      console.error(`[WhatsApp Sender] Error enviando mensaje a ${to}:`, err.message);
      await this._logMessage(tenantId, to, 'outbound', 'text', body, flowStep, null, 'failed');
      throw err;
    }

    return externalId;
  }

  /**
   * Envía un mensaje con plantilla (template) aprobada.
   * Necesario para mensajes proactivos (fuera de la ventana de 24h).
   * @param {string} to - Número destino
   * @param {string} templateName - Nombre de la plantilla registrada
   * @param {string} languageCode - Código de idioma (ej: 'es')
   * @param {Array} parameters - Parámetros del template
   * @param {string} tenantId - ID del tenant
   */
  async sendTemplate(to, templateName, languageCode, parameters, tenantId) {
    let externalId = null;

    try {
      if (this.provider === 'twilio') {
        // Twilio usa content templates
        const msg = await this.client.messages.create({
          from: `whatsapp:${this.config.fromNumber}`,
          to: `whatsapp:${to}`,
          contentSid: templateName, // Twilio ContentSid
          contentVariables: JSON.stringify(
            parameters.reduce((acc, val, i) => ({ ...acc, [i + 1]: val }), {})
          ),
        });
        externalId = msg.sid;
      } else if (this.provider === '360dialog') {
        const components = parameters.length > 0
          ? [{
              type: 'body',
              parameters: parameters.map(p => ({ type: 'text', text: p })),
            }]
          : [];

        const response = await fetch('https://waba.360dialog.io/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'D360-API-KEY': this.config.apiKey,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: to.replace('+', ''),
            type: 'template',
            template: {
              name: templateName,
              language: { code: languageCode },
              components,
            },
          }),
        });
        const data = await response.json();
        externalId = data.messages?.[0]?.id || null;
      }

      await this._logMessage(tenantId, to, 'outbound', 'template', `[template:${templateName}] ${parameters.join(', ')}`, null, externalId, 'sent');
    } catch (err) {
      console.error(`[WhatsApp Sender] Error enviando template a ${to}:`, err.message);
      await this._logMessage(tenantId, to, 'outbound', 'template', `[template:${templateName}]`, null, null, 'failed');
      throw err;
    }

    return externalId;
  }

  /**
   * Registra el mensaje en la tabla whatsapp_messages para auditoría.
   */
  async _logMessage(tenantId, phone, direction, messageType, content, flowStep, externalId, status) {
    try {
      await db.query(
        `INSERT INTO whatsapp_messages
          (tenant_id, phone, direction, message_type, content, flow_step, external_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tenantId, phone, direction, messageType, content, flowStep, externalId, status]
      );
    } catch (err) {
      console.error('[WhatsApp Sender] Error logging message:', err.message);
    }
  }
}

/**
 * Crea un sender configurado para un tenant específico.
 */
async function createSenderForTenant(tenant) {
  const provider = tenant.whatsapp_provider || 'twilio';

  if (provider === 'twilio') {
    return new WhatsAppSender('twilio', {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      fromNumber: tenant.whatsapp_phone,
    });
  }

  if (provider === '360dialog') {
    return new WhatsAppSender('360dialog', {
      apiKey: process.env.DIALOG360_API_KEY,
    });
  }

  throw new Error(`Proveedor WhatsApp no soportado: ${provider}`);
}

module.exports = { WhatsAppSender, createSenderForTenant };
