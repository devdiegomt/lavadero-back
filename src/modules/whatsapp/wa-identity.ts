/**
 * Identificación de clientes que llegan por WhatsApp.
 *
 * WhatsApp multi-device no entrega el teléfono del remitente: la key del
 * mensaje trae sólo el @lid, y contacts.upsert nunca dispara. Comprobado en
 * producción. El @lid sí es estable por usuario, así que es lo que identifica
 * al cliente; el teléfono queda como dato opcional.
 *
 * Los dos se aceptan porque los chats en formato antiguo sí traen número, y
 * un cliente cargado desde el panel tiene teléfono pero no LID.
 */
import * as db from '../../shared/db';
import type { Autorizacion } from './consentimiento';

export interface IdentidadWa {
  phone: string | null;
  waLid: string | null;
}

/** Lee la identidad de un body o query, normalizando lo que venga vacío. */
export function leerIdentidad(fuente: Record<string, unknown>): IdentidadWa {
  const limpiar = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s === '' ? null : s;
  };
  return {
    phone: limpiar(fuente.phone),
    waLid: limpiar(fuente.waLid),
  };
}

/** ¿Alcanza para buscar o crear un cliente? */
export function tieneIdentidad(id: IdentidadWa): boolean {
  return Boolean(id.phone || id.waLid);
}

/**
 * Clave de sesión para las conversaciones en curso.
 * Prefiere el LID: es lo que se mantiene estable entre mensajes.
 */
export function claveSesion(id: IdentidadWa): string {
  return id.waLid ?? id.phone ?? '';
}

export interface ClienteWa {
  id: string;
  first_name: string;
  last_name: string | null;
  visit_count: number;
  phone: string | null;
  wa_lid: string | null;
}

/**
 * Busca al cliente por LID y, si no aparece, por teléfono.
 * Devuelve null si no existe todavía.
 */
export async function buscarCliente(
  tenantId: string,
  id: IdentidadWa,
): Promise<ClienteWa | null> {
  if (id.waLid) {
    const { rows } = await db.query<ClienteWa>(
      `SELECT id, first_name, last_name, visit_count, phone, wa_lid
       FROM customers
       WHERE tenant_id = $1 AND wa_lid = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [tenantId, id.waLid],
    );
    if (rows[0]) return rows[0];
  }

  if (id.phone) {
    const { rows } = await db.query<ClienteWa>(
      `SELECT id, first_name, last_name, visit_count, phone, wa_lid
       FROM customers
       WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [tenantId, id.phone],
    );
    if (rows[0]) return rows[0];
  }

  return null;
}

/**
 * Devuelve el id del cliente, creándolo si hace falta.
 *
 * Cuando encuentra a alguien por teléfono que todavía no tiene LID, se lo
 * completa: así un cliente cargado desde el panel queda enlazado con su
 * WhatsApp la primera vez que escribe, en vez de duplicarse.
 *
 * `ejecutar` permite usarlo dentro de una transacción.
 */
export async function buscarOCrearCliente(
  tenantId: string,
  id: IdentidadWa,
  nombre: string | null,
  ejecutar: typeof db.query = db.query,
  autorizacion?: Autorizacion,
): Promise<string> {
  if (!tieneIdentidad(id)) {
    throw new Error('Se necesita phone o waLid para identificar al cliente');
  }

  if (id.waLid) {
    const { rows } = await ejecutar<{ id: string }>(
      `SELECT id FROM customers
       WHERE tenant_id = $1 AND wa_lid = $2 AND deleted_at IS NULL LIMIT 1`,
      [tenantId, id.waLid],
    );
    if (rows[0]) return rows[0].id;
  }

  if (id.phone) {
    const { rows } = await ejecutar<{ id: string; wa_lid: string | null }>(
      `SELECT id, wa_lid FROM customers
       WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL LIMIT 1`,
      [tenantId, id.phone],
    );
    if (rows[0]) {
      // Enlazar el WhatsApp al cliente que ya existía.
      if (id.waLid && !rows[0].wa_lid) {
        await ejecutar(
          `UPDATE customers SET wa_lid = $1, updated_at = NOW() WHERE id = $2`,
          [id.waLid, rows[0].id],
        );
      }
      return rows[0].id;
    }
  }

  // Alta. Si viene autorizacion se deja constancia de cuando y con que texto:
  // la Ley 1581 pide poder demostrar que el titular autorizo, no solo
  // afirmarlo. Sin autorizacion las columnas quedan NULL, y esos clientes son
  // los que aparecen en el reporte de `clientesSinAutorizacion()`.
  const partes = (nombre ?? 'Cliente WhatsApp').trim().split(/\s+/);
  const { rows } = await ejecutar<{ id: string }>(
    `INSERT INTO customers
       (tenant_id, phone, wa_lid, first_name, last_name,
        consent_at, consent_version, consent_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      tenantId,
      id.phone,
      id.waLid,
      partes[0].slice(0, 80),
      partes.slice(1).join(' ').slice(0, 80) || null,
      autorizacion?.consentAt ?? null,
      autorizacion?.consentVersion ?? null,
      autorizacion?.consentSource ?? null,
    ],
  );
  return rows[0].id;
}
