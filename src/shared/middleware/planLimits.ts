/**
 * Middleware de Límites por Plan.
 *
 * Verifica que el tenant no exceda los límites de su plan antes de
 * permitir acciones que consumen recursos.
 *
 * Uso en rutas:
 *   router.post('/', planLimit('appointments'), asyncHandler(ctrl.create));
 *   router.post('/invoice/:id', planFeature('billing'), asyncHandler(ctrl.generate));
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import * as db from '../db';
import { AppError } from './errorHandler';
import type { PlanRow } from '../../types/entities';
import type { TenantUsageDto } from '../../types/api';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type PlanResource =
  | 'operators'
  | 'appointments'
  | 'services'
  | 'bays'
  | 'whatsapp'
  | 'billing'
  | 'reports';

type UsageField =
  | 'appointments'
  | 'vehicles_created'
  | 'messages_sent'
  | 'invoices_created';

// ─── Cache de planes ──────────────────────────────────────────────────────────

let plansCache: Record<string, PlanRow> | null = null;
let plansCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1_000; // 5 minutos

async function getPlans(): Promise<Record<string, PlanRow>> {
  if (plansCache && Date.now() - plansCacheTime < CACHE_TTL) {
    return plansCache;
  }

  const { rows } = await db.query<Record<string, unknown>>('SELECT * FROM plans WHERE is_active = true');
  plansCache = Object.fromEntries(rows.map((p) => [p['id'], p as unknown as PlanRow]));
  plansCacheTime = Date.now();
  return plansCache as Record<string, PlanRow>;
}

// ─── planLimit ────────────────────────────────────────────────────────────────

/**
 * Middleware factory que verifica un límite del plan antes de la acción.
 * Fail-open: si el plan no se encuentra en BD, deja pasar (no bloquea).
 */
export function planLimit(resource: PlanResource): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tenantId } = req;
      if (!tenantId) return next();

      const { rows: tenantRows } = await db.query<{ plan: string; bays_count: number }>(
        'SELECT plan, bays_count FROM tenants WHERE id = $1',
        [tenantId],
      );
      if (tenantRows.length === 0) return next();

      const tenant = tenantRows[0];
      const plans = await getPlans();
      const plan = plans[tenant.plan];

      if (!plan) {
        console.warn(`[PlanLimit] Plan "${tenant.plan}" no encontrado para tenant ${tenantId}`);
        return next(); // fail-open
      }

      switch (resource) {
        case 'operators': {
          const { rows } = await db.query<{ count: string }>(
            "SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND is_active = true AND role = 'operator'",
            [tenantId],
          );
          const current = parseInt(rows[0].count, 10);
          if (current >= plan.max_operators) {
            throw new AppError(
              `Tu plan "${plan.name}" permite máximo ${plan.max_operators} operadores. ` +
                `Actualmente tienes ${current}. Actualiza tu plan para agregar más.`,
              403,
            );
          }
          break;
        }

        case 'appointments': {
          const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
          const { rows } = await db.query<{ count: string }>(
            `SELECT COUNT(*) FROM appointments
             WHERE tenant_id = $1
               AND scheduled_date >= $2::date
               AND scheduled_date < ($2::date + INTERVAL '1 month')
               AND status != 'cancelled'`,
            [tenantId, currentMonth],
          );
          const current = parseInt(rows[0].count, 10);
          if (current >= plan.max_appointments_month) {
            throw new AppError(
              `Tu plan "${plan.name}" permite máximo ${plan.max_appointments_month} turnos por mes. ` +
                `Este mes ya tienes ${current}. Actualiza tu plan para continuar.`,
              403,
            );
          }
          break;
        }

        case 'services': {
          const { rows } = await db.query<{ count: string }>(
            'SELECT COUNT(*) FROM services WHERE tenant_id = $1 AND is_active = true',
            [tenantId],
          );
          const current = parseInt(rows[0].count, 10);
          if (current >= plan.max_services) {
            throw new AppError(
              `Tu plan "${plan.name}" permite máximo ${plan.max_services} servicios activos. ` +
                `Actualmente tienes ${current}.`,
              403,
            );
          }
          break;
        }

        case 'whatsapp': {
          if (!plan.whatsapp_enabled) {
            throw new AppError(
              'El chatbot de WhatsApp no está disponible en tu plan actual. ' +
                'Actualiza al plan Pro para habilitarlo.',
              403,
            );
          }
          break;
        }

        case 'billing': {
          if (!plan.billing_enabled) {
            throw new AppError(
              'La facturación electrónica no está disponible en tu plan actual. ' +
                'Actualiza al plan Básico o Pro.',
              403,
            );
          }
          break;
        }

        case 'reports': {
          if (!plan.reports_enabled) {
            throw new AppError(
              'Los reportes avanzados no están disponibles en tu plan actual.',
              403,
            );
          }
          break;
        }

        default:
          break;
      }

      next();
    } catch (err) {
      if (err instanceof AppError) return next(err);
      console.error('[PlanLimit] Error verificando límites:', (err as Error).message);
      next(); // fail-open para errores inesperados
    }
  };
}

/**
 * Alias de `planLimit` para features binarias (whatsapp | billing | reports).
 * Semánticamente más claro en las rutas: `planFeature('billing')`.
 */
export function planFeature(feature: Extract<PlanResource, 'whatsapp' | 'billing' | 'reports'>): RequestHandler {
  return planLimit(feature);
}

// ─── getTenantUsage ───────────────────────────────────────────────────────────

/**
 * Devuelve el uso actual del tenant vs los límites de su plan.
 * Usado por `GET /api/tenants/me/usage` y el panel de superadmin.
 */
export async function getTenantUsage(tenantId: string): Promise<TenantUsageDto | null> {
  const { rows: tenantRows } = await db.query<{ plan: string }>(
    'SELECT plan FROM tenants WHERE id = $1',
    [tenantId],
  );
  if (tenantRows.length === 0) return null;

  const plans = await getPlans();
  const plan = plans[tenantRows[0].plan];
  if (!plan) return null;

  const currentMonth = new Date().toISOString().slice(0, 7) + '-01';

  const { rows } = await db.query<{
    operators: string;
    appointments_month: string;
    services: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND is_active = true AND role = 'operator') AS operators,
       (SELECT COUNT(*) FROM appointments
        WHERE tenant_id = $1
          AND scheduled_date >= $2::date
          AND scheduled_date < ($2::date + INTERVAL '1 month')
          AND status != 'cancelled') AS appointments_month,
       (SELECT COUNT(*) FROM services WHERE tenant_id = $1 AND is_active = true) AS services`,
    [tenantId, currentMonth],
  );

  const usage = rows[0];

  const toMetric = (current: number, limit: number) => ({
    current,
    limit,
    pct: Math.round((current / limit) * 100),
  });

  return {
    plan: {
      id: plan.id as TenantUsageDto['plan']['id'],
      name: plan.name,
      priceMonthly: plan.price_monthly,
    },
    usage: {
      operators:    toMetric(parseInt(usage.operators, 10),           plan.max_operators),
      appointments: toMetric(parseInt(usage.appointments_month, 10),  plan.max_appointments_month),
      services:     toMetric(parseInt(usage.services, 10),            plan.max_services),
    },
    features: {
      whatsapp: plan.whatsapp_enabled,
      billing:  plan.billing_enabled,
      reports:  plan.reports_enabled,
    },
  };
}

// ─── incrementUsage ───────────────────────────────────────────────────────────

/**
 * Incrementa un contador de uso mensual del tenant en `tenant_usage`.
 * Llamar después de crear un recurso exitosamente.
 * Silencioso en error (no bloquea la operación principal).
 */
export async function incrementUsage(tenantId: string, field: UsageField): Promise<void> {
  const month = new Date().toISOString().slice(0, 7) + '-01';
  try {
    await db.query(
      `INSERT INTO tenant_usage (tenant_id, month, ${field})
       VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, month)
       DO UPDATE SET ${field} = tenant_usage.${field} + 1, updated_at = NOW()`,
      [tenantId, month],
    );
  } catch (err) {
    console.error('[PlanLimit] Error incrementando uso:', (err as Error).message);
  }
}