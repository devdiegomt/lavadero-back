/**
 * wa-bridge.booking.ts
 *
 * Agendamiento conversacional para el flujo de n8n.
 *
 * Agendar necesita varios turnos de conversación (placa → servicio → horario →
 * confirmar) y n8n no guarda estado entre webhooks. En vez de reimplementar
 * esos pasos como nodos, este endpoint reutiliza flows/booking.js —que ya
 * resuelve disponibilidad según horario y bahías del tenant, precios por tipo
 * de vehículo y alta de clientes nuevos— y guarda el avance en Redis.
 *
 *   POST /api/wa-bridge/booking-step
 *   Body: { phone, message, start }
 *
 *   start:true  arranca el flujo (lo dispara el intent book_appointment).
 *   start:false continúa una conversación en curso; si no hay ninguna
 *               responde { active:false } y n8n sigue con la clasificación.
 */

import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import * as db from '../../shared/db';

// flows/booking.js y session.js siguen en JS (allowJs está activo).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bookingFlow = require('./flows/booking');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SessionManager } = require('./session');

interface BookingSession {
  flow: string;
  step: string;
  data: Record<string, unknown>;
  retries: number;
  createdAt: string;
}

interface FlowResult {
  messages?: string[];
  nextFlow: string | null;
  nextStep: string | null;
  data?: Record<string, unknown>;
  retry?: boolean;
}

interface SessionStore {
  get(tenantId: string, phone: string): Promise<BookingSession | null>;
  set(tenantId: string, phone: string, session: BookingSession): Promise<void>;
  delete(tenantId: string, phone: string): Promise<void>;
}

let sessionManager: SessionStore | null = null;

/** Inyecta el cliente de Redis. Se llama una vez al arrancar el server. */
export function initBooking(redis: Redis): void {
  sessionManager = new SessionManager(redis) as SessionStore;
}

/** Palabras con las que el cliente aborta el flujo en cualquier paso. */
const CANCEL_WORDS = ['0', 'menu', 'menú', 'cancelar', 'salir'];

export async function bookingStep(req: Request, res: Response): Promise<void> {
  const { phone, message, start } = req.body as {
    phone?: string; message?: string; start?: boolean;
  };
  const tenantId = req.tenantId as string;

  if (!phone) {
    res.status(400).json({ error: 'phone es requerido' });
    return;
  }

  // Sin Redis no hay forma de recordar el paso: mejor decirlo que fallar raro.
  if (!sessionManager) {
    res.status(503).json({ error: 'Agendamiento no disponible: Redis no inicializado' });
    return;
  }

  const text = String(message ?? '').trim();
  const session = await sessionManager.get(tenantId, phone);

  // Nada que continuar: que n8n siga con la detección de intención.
  if (!session && !start) {
    res.json({ active: false });
    return;
  }

  // Salir del flujo en cualquier paso.
  if (session && CANCEL_WORDS.includes(text.toLowerCase())) {
    await sessionManager.delete(tenantId, phone);
    res.json({
      active: true,
      done: true,
      reply: 'Listo, cancelé el agendamiento. ¿En qué más te ayudo? 😊',
    });
    return;
  }

  const { rows: tenants } = await db.query<{
    id: string; name: string; opening_time: string; closing_time: string; bays_count: number;
  }>(
    `SELECT id, name, opening_time, closing_time, bays_count
     FROM tenants WHERE id = $1 LIMIT 1`,
    [tenantId],
  );
  if (!tenants[0]) {
    res.status(404).json({ error: 'Tenant no encontrado' });
    return;
  }

  try {
    const result: FlowResult = await bookingFlow.handle({
      text,
      phone,
      tenant: tenants[0],
      // En el arranque no hay sesión: step 'init' pide la placa.
      session: session ?? { flow: 'booking', step: 'init', data: {}, retries: 0 },
    });

    // nextFlow null significa que el flujo terminó (agendado o cancelado).
    if (result.nextFlow) {
      await sessionManager.set(tenantId, phone, {
        flow: result.nextFlow,
        step: result.nextStep as string,
        data: result.data ?? {},
        retries: result.retry ? (session?.retries ?? 0) + 1 : 0,
        createdAt: session?.createdAt ?? new Date().toISOString(),
      });
    } else {
      await sessionManager.delete(tenantId, phone);
    }

    res.json({
      active: true,
      done: !result.nextFlow,
      step: result.nextStep ?? null,
      reply: (result.messages ?? []).join('\n\n'),
    });
  } catch (err) {
    // Un error a mitad del flujo dejaría la sesión en un paso irrecuperable.
    console.error('[wa-bridge] Error en bookingStep:', (err as Error).message);
    await sessionManager.delete(tenantId, phone);
    res.status(500).json({
      active: true,
      done: true,
      error: 'Error en el agendamiento',
      reply: 'Uy, se me cruzaron los cables agendando. ¿Lo intentamos de nuevo? 🙏',
    });
  }
}
