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
  status: 'starting',
};

async function main(): Promise<void> {
  // Arrancar health check primero (Docker necesita el endpoint)
  startHealthServer(PORT, state);

  // Deja constancia en el log de que capacidades trae esta build, para poder
  // descartar de un vistazo que el contenedor este corriendo una imagen vieja.
  console.log(
    '[bot-wa] build con: resolucion-telefono, diagnostico-lid, ' +
    'fallback-sin-n8n, recuperacion-logout'
  );

  // Conectar a WhatsApp
  await startBaileys(state);
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
