/**
 * Servidor HTTP mínimo para health checks (Docker / Kubernetes).
 */
import express from 'express';
import { statSync } from 'fs';
import type { BotState } from './types';

/**
 * Cuando se compilo el codigo que esta corriendo.
 *
 * Docker cachea capas con facilidad y un `up --build` puede dejar la imagen
 * vieja sin avisar. Sin un dato asi, la unica forma de saber si el contenedor
 * tiene el codigo actual es buscar a ojo un log que deberia haber aparecido.
 * El mtime del archivo compilado lo responde sin configurar nada.
 */
function compiladoEn(): string | null {
  try {
    return statSync(__filename).mtime.toISOString();
  } catch {
    return null;
  }
}

const BUILD = compiladoEn();
const ARRANQUE = new Date().toISOString();

export function startHealthServer(port: number, state: BotState): void {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({
      status: state.connected ? 'ok' : 'disconnected',
      // En que punto de la vinculacion esta: awaiting_qr, logged_out, etc.
      state: state.status,
      connected: state.connected,
      // Si esta esperando escaneo, avisar sin volcar el QR entero.
      qrPending: Boolean(state.qrCode),
      lastConnected: state.lastConnected ?? null,
      // Comparar con TENANT_PHONE: si difieren, el backend no resuelve el tenant.
      linkedPhone: state.linkedPhone ?? null,
      tenantPhone: process.env.TENANT_PHONE ?? null,
      // Para distinguir "el codigo es viejo" de "el bot esta mal".
      build: BUILD,
      startedAt: ARRANQUE,
      timestamp: new Date().toISOString(),
    });
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`[health] Escuchando en :${port}/health`);
  });
}
