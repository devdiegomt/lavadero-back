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
      connected: state.connected,
      lastConnected: state.lastConnected ?? null,
      timestamp: new Date().toISOString(),
    });
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`[health] Escuchando en :${port}/health`);
  });
}
