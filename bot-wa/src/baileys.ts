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

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/** Número de WhatsApp del lavadero (para incluirlo en el payload de n8n) */
const TENANT_PHONE = process.env.TENANT_PHONE || '';

/** Carpeta donde se guarda la sesión de WhatsApp */
const AUTH_DIR = process.env.AUTH_DIR || './auth';

let sock: WASocket | null = null;

/**
 * Inicia la conexión con WhatsApp.
 * Se reconecta automáticamente salvo que el usuario haya cerrado sesión.
 */
export async function startBaileys(state: BotState): Promise<void> {
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    // Silenciar el logger interno de Baileys
    logger: pino({ level: 'silent' }) as any,
    // Reducir uso de memoria: no guardar historial
    syncFullHistory: false,
    markOnlineOnConnect: false,
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
        logger.error(
          'Sesion cerrada (loggedOut). Elimina auth/ y reinicia para re-escanear QR.'
        );
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        await processMessage(msg);
      } catch (err) {
        logger.error({ err }, 'Error procesando mensaje');
      }
    }
  });
}

/** Procesa un mensaje entrante y lo reenvía a n8n. */
async function processMessage(msg: proto.IWebMessageInfo): Promise<void> {
  // Ignorar mensajes propios, sin contenido, o de broadcast
  if (!msg.message || msg.key.fromMe) return;

  const jid = msg.key.remoteJid || '';

  // Solo mensajes directos (no grupos)
  if (!jid.endsWith('@s.whatsapp.net') || isJidBroadcast(jid)) return;

  const phone = '+' + jid.replace('@s.whatsapp.net', '');

  // Extraer texto del mensaje (texto plano o extendido)
  const text =
    msg.message.conversation ??
    msg.message.extendedTextMessage?.text ??
    '';

  if (!text.trim()) return;

  const incoming: IncomingMessage = {
    phone,
    message: text.trim().substring(0, 1000),
    tenantPhone: TENANT_PHONE,
    timestamp: new Date(Number(msg.messageTimestamp) * 1000).toISOString(),
    messageId: msg.key.id ?? '',
    pushName: msg.pushName ?? undefined,
  };

  logger.info(
    { from: phone, preview: text.substring(0, 80) },
    'Mensaje recibido'
  );

  const response = await forwardToN8n(incoming);

  if (response?.reply) {
    await sendMessage(phone, response.reply);
  }
}

/** Envía un mensaje de texto al número indicado. */
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
