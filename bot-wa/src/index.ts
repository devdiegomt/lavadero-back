/**
 * Entry point del bot de WhatsApp.
 *
 * Inicia:
 *   1. Servidor HTTP de health check (:3001)
 *   2. Conexion Baileys con WhatsApp
 */
import 'dotenv/config';
import { startBaileys } from './baileys';
import { startHealthServer } from './health';
import type { BotState } from './types';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

/** Estado compartido entre el servidor de health y Baileys */
const state: BotState = {
  connected: false,
};

async function main(): Promise<void> {
  // Arrancar health check primero (Docker necesita el endpoint)
  startHealthServer(PORT, state);

  // Conectar a WhatsApp
  await startBaileys(state);
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
