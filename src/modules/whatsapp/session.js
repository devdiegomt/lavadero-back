/**
 * Manejo de sesiones de conversación WhatsApp en Redis.
 * 
 * Cada sesión se almacena con key: wa:session:{tenantId}:{phone}
 * TTL: 600 segundos (10 min de inactividad)
 * 
 * Estructura:
 * {
 *   flow: string,        // Flujo activo: 'menu', 'status', 'booking', 'prices', 'history'
 *   step: string,        // Paso dentro del flujo
 *   data: object,        // Datos acumulados (placa, servicio, etc.)
 *   retries: number,     // Intentos fallidos en el paso actual
 *   createdAt: string,   // Timestamp de creación
 * }
 */

const SESSION_TTL = 600; // 10 minutos
const MAX_RETRIES = 3;

class SessionManager {
  constructor(redis) {
    this.redis = redis;
  }

  _key(tenantId, phone) {
    return `wa:session:${tenantId}:${phone}`;
  }

  /**
   * Obtiene la sesión actual. Si no existe, retorna null.
   */
  async get(tenantId, phone) {
    const raw = await this.redis.get(this._key(tenantId, phone));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Crea o actualiza la sesión. Resetea el TTL.
   */
  async set(tenantId, phone, session) {
    const key = this._key(tenantId, phone);
    await this.redis.set(key, JSON.stringify(session), 'EX', SESSION_TTL);
  }

  /**
   * Actualiza solo algunos campos de la sesión.
   */
  async update(tenantId, phone, updates) {
    const current = await this.get(tenantId, phone);
    if (!current) return null;

    const updated = { ...current, ...updates };
    if (updates.data) {
      updated.data = { ...current.data, ...updates.data };
    }
    await this.set(tenantId, phone, updated);
    return updated;
  }

  /**
   * Elimina la sesión (flujo completado o reset).
   */
  async delete(tenantId, phone) {
    await this.redis.del(this._key(tenantId, phone));
  }

  /**
   * Crea una sesión nueva con valores iniciales.
   */
  async create(tenantId, phone, flow, step, data = {}) {
    const session = {
      flow,
      step,
      data,
      retries: 0,
      createdAt: new Date().toISOString(),
    };
    await this.set(tenantId, phone, session);
    return session;
  }

  /**
   * Incrementa retries. Retorna true si se excedió el máximo.
   */
  async incrementRetries(tenantId, phone) {
    const session = await this.get(tenantId, phone);
    if (!session) return true;

    session.retries = (session.retries || 0) + 1;
    await this.set(tenantId, phone, session);

    return session.retries >= MAX_RETRIES;
  }
}

module.exports = { SessionManager, SESSION_TTL, MAX_RETRIES };
