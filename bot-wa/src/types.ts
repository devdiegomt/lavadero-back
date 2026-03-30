/**
 * Tipos compartidos para el bot de WhatsApp.
 */

export interface IncomingMessage {
  /** Número del cliente con prefijo +  (ej: +573101234567) */
  phone: string;
  /** Texto del mensaje */
  message: string;
  /** Número de WhatsApp del lavadero (identifica al tenant) */
  tenantPhone: string;
  /** ISO timestamp del mensaje */
  timestamp: string;
  /** ID único del mensaje en WhatsApp */
  messageId: string;
  /** Nombre de perfil del remitente (opcional) */
  pushName?: string;
}

export interface N8nResponse {
  /** Texto de respuesta a enviar al cliente */
  reply: string;
}

export interface BotState {
  /** ¿El socket está conectado a WhatsApp? */
  connected: boolean;
  /** QR code actual (mientras no ha sido escaneado) */
  qrCode?: string;
  /** ISO timestamp de la última conexión exitosa */
  lastConnected?: string;
}
