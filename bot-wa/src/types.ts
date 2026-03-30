export interface IncomingMessage {
  phone: string;
  /** JID original de WhatsApp (puede ser @s.whatsapp.net o @lid) */
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
