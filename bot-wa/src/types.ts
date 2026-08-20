export interface IncomingMessage {
  /**
   * Telefono real del cliente en E.164 (+573001234567), o null si no se
   * pudo resolver. Nunca contiene un @lid: es un identificador interno de
   * WhatsApp y usarlo como telefono corrompe los datos de clientes.
   */
  phone: string | null;
  /** JID de WhatsApp al que se responde (puede ser @s.whatsapp.net o @lid) */
  jid: string;
  message: string;
  tenantPhone: string;
  timestamp: string;
  messageId: string;
  pushName?: string;
}

export interface N8nResponse {
  reply: string;
}

export interface BotState {
  connected: boolean;
  qrCode?: string;
  lastConnected?: string;
}
