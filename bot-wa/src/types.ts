export interface IncomingMessage {
  /**
   * Telefono real del cliente en E.164 (+573001234567), o null si no se
   * pudo resolver. Nunca contiene un @lid: es un identificador interno de
   * WhatsApp y usarlo como telefono corrompe los datos de clientes.
   */
  phone: string | null;
  /** JID de WhatsApp al que se responde (puede ser @s.whatsapp.net o @lid) */
  jid: string;
  /**
   * LID de WhatsApp del cliente (ej: 16733343588585@lid), o null si el chat
   * usa el formato antiguo con numero. Es el identificador estable cuando no
   * hay telefono: WhatsApp multi-device no lo entrega.
   */
  waLid: string | null;
  message: string;
  tenantPhone: string;
  timestamp: string;
  messageId: string;
  pushName?: string;
}

export interface N8nResponse {
  reply: string;
}

/**
 * En que punto del ciclo de vinculacion esta el bot. Se expone en /health
 * para poder diagnosticar sin entrar a leer los logs del contenedor.
 */
export type BotStatus =
  | 'starting'
  | 'awaiting_qr'
  | 'connected'
  | 'reconnecting'
  | 'logged_out';

export interface BotState {
  connected: boolean;
  status: BotStatus;
  qrCode?: string;
  lastConnected?: string;
  /** Numero con el que quedo vinculada la sesion, en E.164. */
  linkedPhone?: string | null;
}
