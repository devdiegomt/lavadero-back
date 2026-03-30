/**
 * Núcleo del bot: conecta con WhatsApp via Baileys,
 * recibe mensajes y los reenvía a n8n.
 */
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  proto,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { forwardToN8n } from './n8n-client';
import type { BotState, IncomingMessage } from './types';

const logger = pino({ level: process.env.LOG_LEVEL || 'debug' });

const TENANT_PHONE = process.env.TENANT_PHONE || '';
const AUTH_DIR = process.env.AUTH_DIR || './auth';

let sock: WASocket | null = null;

export async function startBaileys(state: BotState): Promise<void> {
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  logger.info({ version }, 'Iniciando Baileys');

  sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }) as any,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    // Necesario para recibir mensajes correctamente en modo multi-device
    getMessage: async () => ({ conversation: '' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      state.qrCode = qr;
      qrcode.generate(qr, { small: true });
      logger.info('QR generado — escanea con WhatsApp para conectar');
    }

    if (connection === 'open') {
      state.connected = true;
      state.lastConnected = new Date().toISOString();
      state.qrCode = undefined;
      logger.info('WhatsApp conectado correctamente');
    }

    if (connection === 'close') {
      state.connected = false;
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn({ statusCode, shouldReconnect }, 'Conexion cerrada');

      if (shouldReconnect) {
        const delay = parseInt(process.env.RECONNECT_INTERVAL_MS || '5000', 10);
        logger.info(`Reconectando en ${delay}ms...`);
        setTimeout(() => startBaileys(state), delay);
      } else {
        logger.error('Sesion cerrada (loggedOut). Elimina auth/ y reinicia.');
      }
    }
  });

  // DEBUG: log de TODOS los eventos de mensajes para diagnostico
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    logger.debug({ type, count: messages.length }, 'messages.upsert recibido');

    for (const msg of messages) {
      const jid = msg.key.remoteJid || '';
      const fromMe = msg.key.fromMe;
      const hasContent = !!msg.message;

      logger.debug({ jid, fromMe, hasContent, type }, 'Evaluando mensaje');

      // Procesar solo mensajes entrantes con contenido
      if (!hasContent || fromMe) {
        logger.debug({ fromMe, hasContent }, 'Mensaje ignorado (fromMe o sin contenido)');
        continue;
      }

      if (type !== 'notify' && type !== 'append') {
        logger.debug({ type }, 'Mensaje ignorado (type no es notify/append)');
        continue;
      }

      try {
        await processMessage(msg);
      } catch (err) {
        logger.error({ err }, 'Error procesando mensaje');
      }
    }
  });
}

async function processMessage(msg: proto.IWebMessageInfo): Promise<void> {
  const jid = msg.key.remoteJid || '';

  // Solo mensajes directos (no grupos, no broadcast)
  if (!jid.endsWith('@s.whatsapp.net') || isJidBroadcast(jid)) {
    logger.debug({ jid }, 'Mensaje descartado (grupo o broadcast)');
    return;
  }

  const phone = '+' + jid.replace('@s.whatsapp.net', '');

  const text =
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    '';

  if (!text.trim()) {
    logger.debug({ jid }, 'Mensaje descartado (sin texto)');
    return;
  }

  const incoming: IncomingMessage = {
    phone,
    message: text.trim().substring(0, 1000),
    tenantPhone: TENANT_PHONE,
    timestamp: new Date(Number(msg.messageTimestamp) * 1000).toISOString(),
    messageId: msg.key.id ?? '',
    pushName: msg.pushName ?? undefined,
  };

  logger.info({ from: phone, preview: text.substring(0, 80) }, 'Mensaje recibido');

  const response = await forwardToN8n(incoming);

  if (response?.reply) {
    await sendMessage(phone, response.reply);
  } else {
    logger.warn({ from: phone }, 'n8n no retorno respuesta');
  }
}

export async function sendMessage(phone: string, text: string): Promise<void> {
  if (!sock) {
    logger.error('sendMessage llamado sin socket inicializado');
    return;
  }

  const jid = phone.replace('+', '') + '@s.whatsapp.net';

  try {
    await sock.sendMessage(jid, { text });
    logger.info({ to: phone }, 'Mensaje enviado');
  } catch (err) {
    logger.error({ err, phone }, 'Error enviando mensaje');
  }
}
