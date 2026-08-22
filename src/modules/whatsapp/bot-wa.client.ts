/**
 * Cliente hacia bot-wa para mensajes que inicia el backend.
 *
 * La sesión de WhatsApp vive en el proceso de bot-wa, así que el backend no
 * puede enviar por su cuenta: le pide a bot-wa que envíe. Es el camino de los
 * recordatorios y los avisos de "tu vehículo está listo", a diferencia de las
 * respuestas a un cliente, que las resuelve n8n dentro del mismo intercambio.
 */

const BOT_WA_URL = process.env.BOT_WA_URL ?? 'http://bot-wa:3001';
const SEND_TOKEN = process.env.BOT_WA_SEND_TOKEN ?? '';

export interface ResultadoEnvio {
  enviado: boolean;
  motivo?: string;
}

/**
 * Envía un mensaje por WhatsApp.
 *
 * @param destino JID del cliente: su LID, o un número en E.164.
 * @returns si salió, y por qué no cuando falla — el llamador necesita
 *          distinguir "no se envió" de "se envió" para no marcar como
 *          notificado algo que nunca llegó.
 */
export async function enviarWhatsApp(
  destino: string,
  mensaje: string,
): Promise<ResultadoEnvio> {
  if (!SEND_TOKEN) {
    return { enviado: false, motivo: 'BOT_WA_SEND_TOKEN no configurado' };
  }
  if (!destino) {
    return { enviado: false, motivo: 'destino vacío' };
  }

  try {
    const res = await fetch(`${BOT_WA_URL}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bot-token': SEND_TOKEN },
      body: JSON.stringify({ to: destino, message: mensaje }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      return { enviado: false, motivo: `bot-wa ${res.status}: ${detalle.slice(0, 200)}` };
    }
    return { enviado: true };
  } catch (err) {
    return { enviado: false, motivo: (err as Error).message };
  }
}
