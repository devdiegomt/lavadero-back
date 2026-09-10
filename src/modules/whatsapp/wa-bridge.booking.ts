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
 *   Body: { waLid | phone, message, start }
 *
 *   start:true  arranca el flujo (lo dispara el intent book_appointment).
 *   start:false continúa una conversación en curso; si no hay ninguna
 *               responde { active:false } y n8n sigue con la clasificación.
 */

import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import * as db from '../../shared/db';
import { leerIdentidad, tieneIdentidad, claveSesion, buscarCliente } from './wa-identity';
import { anonimizarCliente } from '../../shared/db/retencion';
import {
  accionSolicitada,
  textoAcceso,
  textoConfirmarSupresion,
  TEXTO_SUPRESION_HECHA,
  TEXTO_SIN_DATOS,
  TEXTO_CONFIRMACION_SIN_CONTEXTO,
  FLUJO_DATOS,
  PASO_CONFIRMAR_SUPRESION,
  type ResumenDatos,
} from './datos-personales';

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
  get(tenantId: string, clave: string): Promise<BookingSession | null>;
  set(tenantId: string, clave: string, session: BookingSession): Promise<void>;
  delete(tenantId: string, clave: string): Promise<void>;
}

let sessionManager: SessionStore | null = null;

/** Inyecta el cliente de Redis. Se llama una vez al arrancar el server. */
export function initBooking(redis: Redis): void {
  sessionManager = new SessionManager(redis) as SessionStore;
}

/** Palabras con las que el cliente aborta el flujo en cualquier paso. */
const CANCEL_WORDS = ['0', 'menu', 'menú', 'cancelar', 'salir'];


/**
 * Reúne lo que el lavadero guarda del titular, para mostrárselo o para
 * advertirle de lo que pierde al borrarlo.
 */
async function resumirDatos(
  tenantId: string,
  customerId: string,
  cliente: { first_name: string; last_name?: string | null; phone: string | null; visit_count: number },
): Promise<ResumenDatos> {
  const { rows: veh } = await db.query<{ plate: string }>(
    `SELECT plate FROM vehicles
     WHERE tenant_id = $1 AND customer_id = $2 AND deleted_at IS NULL
     ORDER BY plate`,
    [tenantId, customerId],
  );

  // Turnos que todavía no ocurrieron y siguen vivos: son los que dejarían de
  // poder avisarse. Un turno ya entregado no cambia nada al borrar.
  const { rows: fut } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM appointments
     WHERE tenant_id = $1 AND customer_id = $2
       AND scheduled_date >= CURRENT_DATE
       AND status NOT IN ('cancelled', 'delivered')`,
    [tenantId, customerId],
  );

  const { rows: cons } = await db.query<{ consent_at: Date | null }>(
    `SELECT consent_at FROM customers WHERE id = $1`,
    [customerId],
  );

  return {
    nombre: [cliente.first_name, cliente.last_name].filter(Boolean).join(' '),
    telefono: cliente.phone,
    visitas: cliente.visit_count ?? 0,
    vehiculos: veh.map((v) => v.plate),
    turnosFuturos: Number(fut[0]?.n ?? 0),
    consentAt: cons[0]?.consent_at ?? null,
  };
}

/**
 * Atiende acceso y supresión. Devuelve la respuesta, o `null` si no había nada
 * que atender —una confirmación suelta, sin solicitud pendiente—.
 *
 * El borrado alcanza únicamente al cliente asociado a **esta** identidad y a
 * **este** lavadero: `anonimizarCliente` lleva el `tenant_id` en el WHERE.
 */
async function atenderDerechosDelTitular(
  accion: 'acceso' | 'supresion' | 'confirmacion',
  tenantId: string,
  identidad: { phone: string | null; waLid: string | null },
  clave: string,
  session: BookingSession | null,
  sesiones: SessionStore,
): Promise<{ active: boolean; done: boolean; reply: string } | null> {
  // Confirmar sólo tiene sentido si hay una supresión esperando.
  if (accion === 'confirmacion') {
    const esperando =
      session?.flow === FLUJO_DATOS && session?.step === PASO_CONFIRMAR_SUPRESION;
    if (!esperando) {
      // Puede ser un "confirmo" del agendamiento u otra cosa: no se secuestra.
      return null;
    }

    const customerId = session?.data?.customerId as string | undefined;
    if (customerId) {
      await anonimizarCliente(tenantId, customerId);
    }
    await sesiones.delete(tenantId, clave);
    return { active: true, done: true, reply: TEXTO_SUPRESION_HECHA };
  }

  const cliente = await buscarCliente(tenantId, identidad);
  if (!cliente) {
    return { active: true, done: true, reply: TEXTO_SIN_DATOS };
  }

  const resumen = await resumirDatos(tenantId, cliente.id, cliente);

  if (accion === 'acceso') {
    return { active: true, done: true, reply: textoAcceso(resumen) };
  }

  // Supresión: no se borra todavía. Se avisa y se espera un CONFIRMO explícito,
  // porque no hay vuelta atrás.
  await sesiones.set(tenantId, clave, {
    flow: FLUJO_DATOS,
    step: PASO_CONFIRMAR_SUPRESION,
    data: { customerId: cliente.id },
    retries: 0,
    createdAt: new Date().toISOString(),
  });

  return { active: true, done: false, reply: textoConfirmarSupresion(resumen) };
}

export async function bookingStep(req: Request, res: Response): Promise<void> {
  const { message, start } = req.body as { message?: string; start?: boolean };
  const tenantId = req.tenantId as string;

  // WhatsApp no entrega el telefono: el LID es lo que identifica al cliente
  // entre mensajes, y por eso es tambien la clave de la sesion.
  const identidad = leerIdentidad(req.body as Record<string, unknown>);
  if (!tieneIdentidad(identidad)) {
    res.status(400).json({ error: 'Se requiere waLid o phone' });
    return;
  }
  const clave = claveSesion(identidad);

  // Sin Redis no hay forma de recordar el paso: mejor decirlo que fallar raro.
  if (!sessionManager) {
    res.status(503).json({ error: 'Agendamiento no disponible: Redis no inicializado' });
    return;
  }

  const text = String(message ?? '').trim();
  const session = await sessionManager.get(tenantId, clave);

  // ── Derechos del titular (Ley 1581) ────────────────────────────────────
  // Va ANTES de todo lo demás, incluido el corte por "no hay sesión": es un
  // derecho que la ley obliga a atender, así que no puede depender de que haya
  // una conversación en curso ni de que el clasificador acierte. Ver
  // datos-personales.ts.
  const enFlujoDatos = session?.flow === FLUJO_DATOS;
  const accionDatos = accionSolicitada(text);

  if (accionDatos) {
    const manejado = await atenderDerechosDelTitular(
      accionDatos, tenantId, identidad, clave, session, sessionManager,
    );
    if (manejado) {
      res.json(manejado);
      return;
    }
    // 'confirmacion' sin solicitud pendiente cae acá: no se trata como
    // petición de datos y sigue el camino normal.
  }

  // Estando a la espera de confirmar un borrado, todo lo demás se queda en
  // este flujo. Sin esto, cualquier otra cosa caería en flows/booking.js con
  // un paso que ese archivo no conoce.
  if (enFlujoDatos) {
    if (CANCEL_WORDS.includes(text.toLowerCase())) {
      await sessionManager.delete(tenantId, clave);
      res.json({
        active: true,
        done: true,
        reply: 'Listo, no borramos nada. Tus datos siguen como estaban. 🙂',
      });
      return;
    }

    // Ni confirmó ni desistió: se repregunta en vez de interpretar. Con un
    // borrado irreversible de por medio, adivinar no es una opción.
    res.json({
      active: true,
      done: false,
      reply:
        'Necesito una respuesta clara.\n\n' +
        'Escribe *CONFIRMO* para borrar tus datos, o *0* para dejarlo así.',
    });
    return;
  }

  // Nada que continuar: que n8n siga con la detección de intención.
  if (!session && !start) {
    res.json({ active: false });
    return;
  }

  // Salir del flujo en cualquier paso.
  if (session && CANCEL_WORDS.includes(text.toLowerCase())) {
    await sessionManager.delete(tenantId, clave);
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
      phone: identidad.phone,
      waLid: identidad.waLid,
      tenant: tenants[0],
      // En el arranque no hay sesión: step 'init' pide la placa.
      session: session ?? { flow: 'booking', step: 'init', data: {}, retries: 0 },
    });

    // nextFlow null significa que el flujo terminó (agendado o cancelado).
    if (result.nextFlow) {
      await sessionManager.set(tenantId, clave, {
        flow: result.nextFlow,
        step: result.nextStep as string,
        data: result.data ?? {},
        retries: result.retry ? (session?.retries ?? 0) + 1 : 0,
        createdAt: session?.createdAt ?? new Date().toISOString(),
      });
    } else {
      await sessionManager.delete(tenantId, clave);
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
    await sessionManager.delete(tenantId, clave);
    res.status(500).json({
      active: true,
      done: true,
      error: 'Error en el agendamiento',
      reply: 'Uy, se me cruzaron los cables agendando. ¿Lo intentamos de nuevo? 🙏',
    });
  }
}
