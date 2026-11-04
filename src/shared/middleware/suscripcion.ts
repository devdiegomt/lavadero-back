/**
 * Prueba gratis y suscripción: cuándo el panel queda en sólo lectura.
 *
 * El registro prometía «14 días de prueba en funciones avanzadas» y nada en el
 * código miraba esa fecha: el lavadero nuevo quedaba en el plan Gratis desde el
 * primer día. Ahora entra en prueba del plan Estudio Pro, y al vencer:
 *
 * - **Sigue viendo todo.** Sus clientes, su historial, sus reportes. Nada se
 *   borra ni se esconde: los datos son del lavadero.
 * - **No puede registrar nada nuevo** hasta elegir plan. Toda petición que
 *   cambia algo responde 402 con un mensaje que dice qué pasó y qué hacer.
 *
 * Una excepción a propósito: **anonimizar a un cliente** se puede siempre. Es
 * el derecho de supresión de la Ley 1581, y que el lavadero no haya pagado no
 * se lo quita a la persona.
 *
 * Mientras no haya cobro con tarjeta, `active` lo pone el superadmin a mano
 * cuando el lavadero paga.
 */
import type { Request, Response, NextFunction } from 'express';
import * as db from '../db';
import { AppError } from './errorHandler';
import type { SubscriptionStatus } from '../../types/entities';

export interface FilaSuscripcion {
  subscription_status: SubscriptionStatus;
  trial_ends_at: Date | string | null;
  discount_pct: number;
  discount_until: Date | string | null;
}

const DIA_MS = 24 * 60 * 60 * 1_000;

export function estadoDeSuscripcion(
  t: Pick<FilaSuscripcion, 'subscription_status' | 'trial_ends_at'>,
  ahora: Date = new Date(),
): { soloLectura: boolean; diasDePrueba: number | null } {
  if (t.subscription_status === 'suspended') return { soloLectura: true, diasDePrueba: null };
  if (t.subscription_status === 'active') return { soloLectura: false, diasDePrueba: null };

  // En prueba. Sin fecha de fin —lavaderos creados a mano o por las pruebas—
  // no hay nada que vencer.
  if (!t.trial_ends_at) return { soloLectura: false, diasDePrueba: null };
  const restante = new Date(t.trial_ends_at).getTime() - ahora.getTime();
  return {
    soloLectura: restante <= 0,
    diasDePrueba: Math.max(0, Math.ceil(restante / DIA_MS)),
  };
}

/** El precio con el descuento del lavadero, si lo tiene y no venció. */
export function precioConDescuento(
  precio: number,
  t: Pick<FilaSuscripcion, 'discount_pct' | 'discount_until'>,
  ahora: Date = new Date(),
): number {
  if (!t.discount_pct) return precio;
  if (t.discount_until && new Date(t.discount_until).getTime() + DIA_MS <= ahora.getTime()) return precio;
  return Math.round((precio * (100 - t.discount_pct)) / 100);
}

const LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Lo que se puede hacer aunque el panel esté en sólo lectura. */
function permitidaSiempre(req: Request): boolean {
  // Derecho de supresión (Ley 1581): no depende de que el lavadero pague.
  return req.method === 'POST' && /^\/api\/customers\/[^/]+\/anonimizar\/?$/.test(req.originalUrl.split('?')[0]);
}

export async function exigirSuscripcionVigente(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (LECTURA.has(req.method) || permitidaSiempre(req)) return next();
  try {
    const { rows } = await db.query<FilaSuscripcion>(
      'SELECT subscription_status, trial_ends_at, discount_pct, discount_until FROM tenants WHERE id = $1',
      [req.tenantId as string],
    );
    if (rows.length === 0) return next();
    const fila = rows[0];
    if (!estadoDeSuscripcion(fila).soloLectura) return next();

    next(
      new AppError(
        fila.subscription_status === 'suspended'
          ? 'Tu cuenta de Qlarity está suspendida: puedes ver todo, pero no registrar cambios. ' +
              'Escríbenos para reactivarla.'
          : 'Tu prueba de Qlarity terminó: puedes ver todos tus datos, pero para registrar ' +
              'turnos, pagos o cambios tienes que elegir un plan en Configuración → Plan.',
        402,
      ),
    );
  } catch (err) {
    next(err);
  }
}
