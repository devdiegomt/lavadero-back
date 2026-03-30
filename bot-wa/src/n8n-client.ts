/**
 * Cliente HTTP para enviar mensajes al webhook de n8n.
 */
import axios, { AxiosError } from 'axios';
import pino from 'pino';
import type { IncomingMessage, N8nResponse } from './types';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL || 'http://n8n:5678/webhook/whatsapp';
const N8N_AUTH_TOKEN = process.env.N8N_AUTH_TOKEN || '';

/**
 * Reenvía un mensaje entrante a n8n y devuelve la respuesta.
 * Si n8n no está disponible o retorna error, devuelve null.
 */
export async function forwardToN8n(
  msg: IncomingMessage
): Promise<N8nResponse | null> {
  try {
    const response = await axios.post<N8nResponse>(N8N_WEBHOOK_URL, msg, {
      headers: {
        'Content-Type': 'application/json',
        ...(N8N_AUTH_TOKEN
          ? { Authorization: `Bearer ${N8N_AUTH_TOKEN}` }
          : {}),
      },
      timeout: 30_000,
    });

    if (response.data?.reply) {
      return response.data;
    }

    logger.warn({ data: response.data }, 'n8n respondio sin campo reply');
    return null;
  } catch (err) {
    const error = err as AxiosError;
    logger.error(
      {
        message: error.message,
        status: error.response?.status,
        url: N8N_WEBHOOK_URL,
      },
      'Error al enviar a n8n'
    );
    return null;
  }
}
