/**
 * Servidor HTTP mínimo para health checks (Docker / Kubernetes).
 */
import express from 'express';
import type { BotState } from './types';

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
      timestamp: new Date().toISOString(),
    });
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`[health] Escuchando en :${port}/health`);
  });
}
