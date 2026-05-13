import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import type { ServiceRow } from '../../types/entities';
import type { ServiceCreateBody } from '../../shared/middleware/validate';

const FIELD_MAP: Record<string, keyof ServiceRow> = {
  name: 'name', description: 'description',
  priceSedan: 'price_sedan', priceSuv: 'price_suv',
  priceCamioneta: 'price_camioneta', priceMoto: 'price_moto', pricePickup: 'price_pickup',
  estimatedMinutes: 'estimated_minutes', sortOrder: 'sort_order',
};

// ─── GET /api/services ────────────────────────────────────────────────────────

export async function list(req: Request, res: Response): Promise<void> {
  const showAll = req.query.all === 'true';
  const where = showAll ? 'tenant_id = $1' : 'tenant_id = $1 AND is_active = true';

  const { rows } = await db.query<ServiceRow>(
    `SELECT * FROM services WHERE ${where} ORDER BY sort_order, name`,
    [req.tenantId],
  );
  res.json(rows);
}

// ─── GET /api/services/:id ────────────────────────────────────────────────────

export async function getById(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<ServiceRow>(
    'SELECT * FROM services WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId],
  );
  if (rows.length === 0) throw new AppError('Servicio no encontrado', 404);
  res.json(rows[0]);
}

// ─── POST /api/services ───────────────────────────────────────────────────────

export async function create(req: Request, res: Response): Promise<void> {
  const { name, description, priceSedan, priceSuv, priceCamioneta, priceMoto, pricePickup,
          estimatedMinutes, sortOrder } = req.body as ServiceCreateBody;

  const { rows } = await db.query<ServiceRow>(
    `INSERT INTO services
       (tenant_id, name, description, price_sedan, price_suv, price_camioneta, price_moto, price_pickup, estimated_minutes, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [req.tenantId, name.trim(), description?.trim() ?? null,
     priceSedan ?? 0, priceSuv ?? 0, priceCamioneta ?? 0, priceMoto ?? 0, pricePickup ?? 0,
     estimatedMinutes ?? 60, sortOrder ?? 0],
  );

  res.status(201).json(rows[0]);
}

// ─── PATCH /api/services/:id ──────────────────────────────────────────────────

export async function update(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [jsKey, dbKey] of Object.entries(FIELD_MAP)) {
    if (body[jsKey] !== undefined) {
      updates.push(`${dbKey} = $${idx}`);
      values.push(body[jsKey]);
      idx++;
    }
  }

  if (updates.length === 0) throw new AppError('No hay campos para actualizar', 400);

  values.push(req.params.id, req.tenantId);
  const { rows } = await db.query<ServiceRow>(
    `UPDATE services SET ${updates.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    values as (string | number | boolean | null)[],
  );

  if (rows.length === 0) throw new AppError('Servicio no encontrado', 404);
  res.json(rows[0]);
}

// ─── PATCH /api/services/:id/toggle ──────────────────────────────────────────

export async function toggle(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<ServiceRow>(
    `UPDATE services SET is_active = NOT is_active
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, req.tenantId],
  );
  if (rows.length === 0) throw new AppError('Servicio no encontrado', 404);
  res.json(rows[0]);
}