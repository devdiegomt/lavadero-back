/**
 * Servidor HTTP del bot: health check y envio saliente.
 *
 * El envio existe porque el backend necesita iniciar mensajes (recordatorios,
 * "tu vehiculo esta listo") y la sesion de WhatsApp vive solo en este proceso.
 */
import express from 'express';
import { statSync } from 'fs';
import type { BotState } from './types';
import { sendMessage } from './baileys';

/**
 * Token compartido con el backend. Sin el, cualquiera que alcance el puerto
 * puede mandar mensajes desde el numero del lavadero, asi que el endpoint
 * queda deshabilitado en vez de abierto.
 */
const SEND_TOKEN = process.env.BOT_WA_SEND_TOKEN || '';

/**
 * Cuando se compilo el codigo que esta corriendo.
 *
 * Docker cachea capas con facilidad y un `up --build` puede dejar la imagen
 * vieja sin avisar. Sin un dato asi, la unica forma de saber si el contenedor
 * tiene el codigo actual es buscar a ojo un log que deberia haber aparecido.
 * El mtime del archivo compilado lo responde sin configurar nada.
 */
function compiladoEn(): string | null {
  try {
    return statSync(__filename).mtime.toISOString();
  } catch {
    return null;
  }
}

const BUILD = compiladoEn();
const ARRANQUE = new Date().toISOString();

export function startHealthServer(port: number, state: BotState): void {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({
      status: state.connected ? 'ok' : 'disconnected',
      // En que punto de la vinculacion esta: awaiting_qr, logged_out, etc.
      state: state.status,
      connected: state.connected,
      // Si esta esperando escaneo, avisar sin volcar el QR entero.
      qrPending: Boolean(state.qrCode),
      lastConnected: state.lastConnected ?? null,
      // Comparar con TENANT_PHONE: si difieren, el backend no resuelve el tenant.
      linkedPhone: state.linkedPhone ?? null,
      tenantPhone: process.env.TENANT_PHONE ?? null,
      // Para distinguir "el codigo es viejo" de "el bot esta mal".
      build: BUILD,
      startedAt: ARRANQUE,
      timestamp: new Date().toISOString(),
    });
  });

  // ---------------------------------------------------------------------
  // POST /send — mensajes que inicia el backend, no respuestas a un cliente.
  // ---------------------------------------------------------------------
  app.post('/send', express.json({ limit: '64kb' }), async (req, res) => {
    if (!SEND_TOKEN) {
      res.status(503).json({
        error: 'BOT_WA_SEND_TOKEN no configurado: el envio saliente esta deshabilitado',
      });
      return;
    }
    if (req.headers['x-bot-token'] !== SEND_TOKEN) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }
    if (!state.connected) {
      res.status(503).json({ error: 'WhatsApp no conectado', state: state.status });
      return;
    }

    const { to, message } = req.body as { to?: string; message?: string };
    if (!to || !message) {
      res.status(400).json({ error: 'to y message son requeridos' });
      return;
    }

    // `to` es un JID: el LID del cliente, o numero@s.whatsapp.net.
    const jid = to.includes('@')
      ? to
      : to.replace(/^\+/, '') + '@s.whatsapp.net';

    const enviado = await sendMessage(jid, String(message).slice(0, 4000));
    if (!enviado) {
      res.status(502).json({ error: 'WhatsApp rechazo el envio', to: jid });
      return;
    }
    res.json({ sent: true, to: jid });
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`[health] Escuchando en :${port}/health`);
  });
}
