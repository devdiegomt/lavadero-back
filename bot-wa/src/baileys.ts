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

const TENANT_PHONE = process.env.TENANT_PHONE || '';
const AUTH_DIR = process.env.AUTH_DIR || './auth';

let sock: WASocket | null = null;

/**
 * Mapa de LID (@lid) → JID real (@s.whatsapp.net).
 * Se puebla con los eventos contacts.upsert de Baileys.
 * Necesario porque WhatsApp multi-device usa LIDs internos
 * que no corresponden al numero de telefono real.
 */
const lidToJid = new Map<string, string>();

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
    getMessage: async () => ({ conversation: '' }),
  });

  sock.ev.on('creds.update', saveCreds);

  // Construir mapa LID -> JID real cuando llegan contactos
  sock.ev.on('contacts.upsert', (contacts) => {
    for (const contact of contacts) {
      const phoneJid = contact.id;           // ej: 573001234567@s.whatsapp.net
      const lid = (contact as any).lid;     // ej: 16733343588585@lid

      if (phoneJid && lid) {
        lidToJid.set(lid, phoneJid);
        logger.info({ lid, phoneJid }, 'Mapeado LID -> JID');
      }
    }
  });

  sock.ev.on('contacts.update', (updates) => {
    for (const update of updates) {
      const phoneJid = update.id;
      const lid = (update as any).lid;
      if (phoneJid && lid) {
        lidToJid.set(lid, phoneJid);
        logger.info({ lid, phoneJid }, 'Actualizado LID -> JID');
      }
    }
  });

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
        setTimeout(() => startBaileys(state), delay);
      } else {
        logger.error('Sesion cerrada (loggedOut). Elimina auth/ y reinicia.');
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;
    for (const msg of messages) {
      try {
        await processMessage(msg);
      } catch (err) {
        logger.error({ err }, 'Error procesando mensaje');
      }
    }
  });
}

/**
 * Resuelve el JID correcto para enviar una respuesta.
 * Si el JID entrante es @lid, busca el numero real en el mapa.
 * Si no esta en el mapa aun, extrae el numero del @lid como fallback
 * (funciona cuando el LID coincide con el numero de telefono).
 */
function resolveReplyJid(incomingJid: string): string {
  if (incomingJid.endsWith('@lid')) {
    const resolved = lidToJid.get(incomingJid);
    if (resolved) {
      logger.info({ lid: incomingJid, resolved }, 'JID resuelto desde mapa');
      return resolved;
    }
    logger.warn({ lid: incomingJid }, 'LID no encontrado en mapa, usando @lid directo');
  }
  return incomingJid;
}

async function processMessage(msg: proto.IWebMessageInfo): Promise<void> {
  if (!msg.message || msg.key.fromMe) return;

  const jid = msg.key.remoteJid || '';
  if (isJidBroadcast(jid)) return;

  const isDirect = jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid');
  if (!isDirect) return;

  // Intentar resolver el JID real lo antes posible
  const replyJid = resolveReplyJid(jid);
  const phone = '+' + replyJid.replace(/@s\.whatsapp\.net$|@lid$/, '');

  const text =
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    '';

  if (!text.trim()) return;

  const incoming: IncomingMessage = {
    phone,
    jid: replyJid,
    message: text.trim().substring(0, 1000),
    tenantPhone: TENANT_PHONE,
    timestamp: new Date(Number(msg.messageTimestamp) * 1000).toISOString(),
    messageId: msg.key.id ?? '',
    pushName: msg.pushName ?? undefined,
  };

  logger.info({ from: phone, replyJid, preview: text.substring(0, 80) }, 'Mensaje recibido');

  const response = await forwardToN8n(incoming);

  if (response?.reply) {
    await sendMessage(replyJid, response.reply);
  } else {
    logger.warn({ from: phone }, 'n8n no retorno respuesta');
  }
}

export async function sendMessage(jid: string, text: string): Promise<void> {
  if (!sock) {
    logger.error('Socket no inicializado');
    return;
  }
  try {
    await sock.sendMessage(jid, { text });
    logger.info({ to: jid }, 'Mensaje enviado');
  } catch (err) {
    logger.error({ err, jid }, 'Error enviando mensaje');
  }
}
