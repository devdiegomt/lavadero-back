/**
 * Middleware de Límites por Plan
 * 
 * Verifica que el tenant no exceda los límites de su plan antes de
 * permitir acciones que consumen recursos (crear operadores, turnos, servicios).
 * 
 * Uso en rutas:
 *   router.post('/', planLimit('operators'), asyncHandler(ctrl.create));
 *   router.post('/', planLimit('appointments'), asyncHandler(ctrl.create));
 */

const db = require('../db');
const { AppError } = require('./errorHandler');

// Cache de planes en memoria (se recarga cada 5 min)
let plansCache = null;
let plansCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function getPlans() {
  if (plansCache && Date.now() - plansCacheTime < CACHE_TTL) {
    return plansCache;
  }
  const { rows } = await db.query('SELECT * FROM plans WHERE is_active = true');
  plansCache = {};
  for (const p of rows) {
    plansCache[p.id] = p;
  }
  plansCacheTime = Date.now();
  return plansCache;
}

/**
 * Factory de middleware que verifica un límite específico del plan.
 * 
 * @param {'operators'|'appointments'|'services'|'bays'|'whatsapp'|'billing'|'reports'} resource
 * @returns Express middleware
 */
function planLimit(resource) {
  return async (req, res, next) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return next();

      // Obtener plan del tenant
      const { rows: tenantRows } = await db.query(
        'SELECT plan, bays_count FROM tenants WHERE id = $1',
        [tenantId]
      );
      if (tenantRows.length === 0) return next();

      const tenant = tenantRows[0];
      const plans = await getPlans();
      const plan = plans[tenant.plan];

      if (!plan) {
        // Plan no reconocido, dejar pasar (fail-open para no bloquear)
        console.warn(`[PlanLimit] Plan "${tenant.plan}" no encontrado para tenant ${tenantId}`);
        return next();
      }

      // Verificar según el recurso
      switch (resource) {
        case 'operators': {
          const { rows } = await db.query(
            'SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND is_active = true AND role = $2',
            [tenantId, 'operator']
          );
          const current = parseInt(rows[0].count);
          if (current >= plan.max_operators) {
            throw new AppError(
              `Tu plan "${plan.name}" permite máximo ${plan.max_operators} operadores. Actualmente tienes ${current}. Actualiza tu plan para agregar más.`,
              403
            );
          }
          break;
        }

        case 'appointments': {
          const currentMonth = new Date().toISOString().slice(0, 7) + '-01'; // YYYY-MM-01
          const { rows } = await db.query(
            `SELECT COUNT(*) FROM appointments
             WHERE tenant_id = $1
               AND scheduled_date >= $2::date
               AND scheduled_date < ($2::date + INTERVAL '1 month')
               AND status != 'cancelled'`,
            [tenantId, currentMonth]
          );
          const current = parseInt(rows[0].count);
          if (current >= plan.max_appointments_month) {
            throw new AppError(
              `Tu plan "${plan.name}" permite máximo ${plan.max_appointments_month} turnos por mes. Este mes ya tienes ${current}. Actualiza tu plan para continuar.`,
              403
            );
          }
          break;
        }

        case 'services': {
          const { rows } = await db.query(
            'SELECT COUNT(*) FROM services WHERE tenant_id = $1 AND is_active = true',
            [tenantId]
          );
          const current = parseInt(rows[0].count);
          if (current >= plan.max_services) {
            throw new AppError(
              `Tu plan "${plan.name}" permite máximo ${plan.max_services} servicios activos. Actualmente tienes ${current}.`,
              403
            );
          }
          break;
        }

        case 'whatsapp': {
          if (!plan.whatsapp_enabled) {
            throw new AppError(
              'El chatbot de WhatsApp no está disponible en tu plan actual. Actualiza al plan Pro para habilitarlo.',
              403
            );
          }
          break;
        }

        case 'billing': {
          if (!plan.billing_enabled) {
            throw new AppError(
              'La facturación electrónica no está disponible en tu plan actual. Actualiza al plan Básico o Pro.',
              403
            );
          }
          break;
        }

        case 'reports': {
          if (!plan.reports_enabled) {
            throw new AppError(
              'Los reportes avanzados no están disponibles en tu plan actual.',
              403
            );
          }
          break;
        }

        default:
          break;
      }

      next();
    } catch (err) {
      if (err.isOperational) return next(err);
      console.error('[PlanLimit] Error verificando límites:', err.message);
      next(); // fail-open
    }
  };
}

/**
 * Obtiene el uso actual de un tenant vs los límites de su plan.
 * Útil para mostrar indicadores en el frontend.
 */
async function getTenantUsage(tenantId) {
  const { rows: tenantRows } = await db.query(
    'SELECT plan FROM tenants WHERE id = $1', [tenantId]
  );
  if (tenantRows.length === 0) return null;

  const plans = await getPlans();
  const plan = plans[tenantRows[0].plan];
  if (!plan) return null;

  const currentMonth = new Date().toISOString().slice(0, 7) + '-01';

  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND is_active = true AND role = 'operator') as operators,
      (SELECT COUNT(*) FROM appointments WHERE tenant_id = $1 AND scheduled_date >= $2::date AND scheduled_date < ($2::date + INTERVAL '1 month') AND status != 'cancelled') as appointments_month,
      (SELECT COUNT(*) FROM services WHERE tenant_id = $1 AND is_active = true) as services
  `, [tenantId, currentMonth]);

  const usage = rows[0];

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      priceMonthly: plan.price_monthly,
    },
    usage: {
      operators: { current: parseInt(usage.operators), limit: plan.max_operators, pct: Math.round(parseInt(usage.operators) / plan.max_operators * 100) },
      appointments: { current: parseInt(usage.appointments_month), limit: plan.max_appointments_month, pct: Math.round(parseInt(usage.appointments_month) / plan.max_appointments_month * 100) },
      services: { current: parseInt(usage.services), limit: plan.max_services, pct: Math.round(parseInt(usage.services) / plan.max_services * 100) },
    },
    features: {
      whatsapp: plan.whatsapp_enabled,
      billing: plan.billing_enabled,
      reports: plan.reports_enabled,
    },
  };
}

/**
 * Verifica si una feature está habilitada en el plan del tenant.
 * Alternativa a planLimit('whatsapp'|'billing'|'reports') para uso directo.
 * 
 * @param {'whatsapp' | 'billing' | 'reports'} feature
 */
function planFeature(feature) {
  return planLimit(feature);
}

/**
 * Incrementa contadores de uso mensual del tenant.
 * Llamar después de crear un recurso exitosamente.
 * 
 * @param {string} tenantId
 * @param {'appointments' | 'vehicles_created' | 'messages_sent' | 'invoices_created'} field
 */
async function incrementUsage(tenantId, field) {
  const month = new Date().toISOString().slice(0, 7) + '-01';
  try {
    await db.query(
      `INSERT INTO tenant_usage (tenant_id, month, ${field})
       VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, month)
       DO UPDATE SET ${field} = tenant_usage.${field} + 1, updated_at = NOW()`,
      [tenantId, month]
    );
  } catch (err) {
    console.error('[PlanLimit] Error incrementando uso:', err.message);
  }
}

module.exports = { planLimit, planFeature, incrementUsage, getTenantUsage };
