/**
 * Lectura del rastro de acciones.
 *
 * La brecha era "no se puede reconstruir quién cambió qué", así que guardarlo no
 * alcanza: hay que poder preguntarlo. Son las tres preguntas que se hacen de
 * verdad cuando algo aparece cambiado y nadie sabe por qué:
 *
 * - ¿Qué pasó acá? → filtrando por `entity` y `entityId`
 * - ¿Qué hizo esta persona? → filtrando por `userId`
 * - ¿Qué pasó ese día? → filtrando por `from` y `to`
 *
 * Sólo `admin`: es la bitácora del personal, y da visibilidad sobre lo que hacen
 * los compañeros de turno.
 */
import type { Request, Response } from 'express';
import * as db from '../../shared/db';

interface FilaAuditoria {
  id: string;
  user_email: string | null;
  user_role: string | null;
  method: string;
  route: string;
  entity: string | null;
  entity_id: string | null;
  status_code: number;
  fields: string[] | null;
  created_at: Date;
}

// ─── GET /api/audit ───────────────────────────────────────────────────────────

export async function list(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const page = parseInt(q.page ?? '1', 10);
  const limit = parseInt(q.limit ?? '50', 10);
  const offset = (page - 1) * limit;

  const params: unknown[] = [req.tenantId];
  let where = 'tenant_id = $1';

  if (q.userId) {
    params.push(q.userId);
    where += ` AND user_id = $${params.length}`;
  }
  if (q.entity) {
    params.push(q.entity);
    where += ` AND entity = $${params.length}`;
  }
  if (q.entityId) {
    params.push(q.entityId);
    where += ` AND entity_id = $${params.length}`;
  }
  if (q.from) {
    params.push(q.from);
    where += ` AND created_at >= $${params.length}::date`;
  }
  if (q.to) {
    params.push(q.to);
    // Fin del día inclusive: quien filtra "hasta el 15" espera ver el 15.
    where += ` AND created_at < ($${params.length}::date + INTERVAL '1 day')`;
  }
  if (q.soloFallidas === 'true') {
    where += ' AND status_code >= 400';
  }

  const { rows: conteo } = await db.query<{ count: string }>(
    `SELECT COUNT(*) FROM action_log WHERE ${where}`,
    params as (string | number)[],
  );

  params.push(limit, offset);
  const { rows } = await db.query<FilaAuditoria>(
    `SELECT id, user_email, user_role, method, route, entity, entity_id,
            status_code, fields, created_at
     FROM action_log
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params as (string | number)[],
  );

  res.json({
    data: rows,
    pagination: { total: parseInt(conteo[0].count, 10), page, limit },
    // Se dice explícitamente para que nadie espere encontrar acá el valor
    // anterior de un campo: no se guarda, y es a propósito.
    nota: 'Se registran los nombres de los campos enviados, nunca sus valores.',
  });
}
