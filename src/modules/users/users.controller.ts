import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import type { UserRow } from '../../types/entities';
import type { UserCreateBody } from '../../shared/middleware/validate';

type UserPublicRow = Pick<UserRow,
  'id' | 'email' | 'first_name' | 'last_name' | 'phone' | 'role' | 'is_active' | 'last_login_at' | 'created_at'
>;

const FIELD_MAP: Partial<Record<string, keyof UserRow>> = {
  firstName: 'first_name',
  lastName:  'last_name',
  phone:     'phone',
  email:     'email',
  role:      'role',
};

// ─── GET /api/users ───────────────────────────────────────────────────────────

export async function list(req: Request, res: Response): Promise<void> {
  const { rows } = await db.query<UserPublicRow>(
    `SELECT id, email, first_name, last_name, phone, role, is_active, last_login_at, created_at
     FROM users
     WHERE tenant_id = $1
     ORDER BY
       CASE role WHEN 'admin' THEN 1 WHEN 'operator' THEN 2 ELSE 3 END,
       first_name`,
    [req.tenantId],
  );
  res.json(rows);
}

// ─── POST /api/users ──────────────────────────────────────────────────────────

export async function create(req: Request, res: Response): Promise<void> {
  const { email, password, firstName, lastName, phone, role } =
    req.body as UserCreateBody;

  const passwordHash = await bcrypt.hash(password, 10);

  const { rows } = await db.query<UserPublicRow>(
    `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, phone, role)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email, first_name, last_name, phone, role, is_active, created_at`,
    [req.tenantId, email.toLowerCase().trim(), passwordHash,
     firstName.trim(), lastName?.trim() ?? null, phone?.trim() ?? null, role ?? 'operator'],
  );

  res.status(201).json(rows[0]);
}

// ─── PATCH /api/users/:id ─────────────────────────────────────────────────────

export async function update(req: Request, res: Response): Promise<void> {
  const body = req.body as Partial<{ firstName: string; lastName: string; phone: string; email: string; role: string }>;

  // No permitir cambio de rol propio
  if (req.params.id === req.user!.id && body.role !== undefined) {
    throw new AppError('No puedes cambiar tu propio rol', 400);
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [jsKey, dbKey] of Object.entries(FIELD_MAP)) {
    const val = body[jsKey as keyof typeof body];
    if (val !== undefined) {
      updates.push(`${dbKey} = $${idx}`);
      values.push(dbKey === 'email' ? (val as string).toLowerCase().trim() : val);
      idx++;
    }
  }

  if (updates.length === 0) throw new AppError('No hay campos para actualizar', 400);

  values.push(req.params.id, req.tenantId);
  const { rows } = await db.query<UserPublicRow>(
    `UPDATE users SET ${updates.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1}
     RETURNING id, email, first_name, last_name, phone, role, is_active`,
    values as (string | number | boolean | null)[],
  );

  if (rows.length === 0) throw new AppError('Usuario no encontrado', 404);
  res.json(rows[0]);
}

// ─── PATCH /api/users/:id/toggle ─────────────────────────────────────────────

export async function toggle(req: Request, res: Response): Promise<void> {
  if (req.params.id === req.user!.id) {
    throw new AppError('No puedes desactivar tu propia cuenta', 400);
  }

  const { rows } = await db.query<Pick<UserRow, 'id' | 'first_name' | 'is_active'>>(
    `UPDATE users SET is_active = NOT is_active
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, first_name, is_active`,
    [req.params.id, req.tenantId],
  );

  if (rows.length === 0) throw new AppError('Usuario no encontrado', 404);
  res.json(rows[0]);
}

// ─── PATCH /api/users/:id/password ───────────────────────────────────────────

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword: string;
  };

  const targetId = req.params.id;
  const isSelf  = targetId === req.user!.id;
  const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';

  if (!isSelf && !isAdmin) {
    throw new AppError('No tienes permisos para cambiar esta contraseña', 403);
  }

  if (isSelf) {
    if (!currentPassword) throw new AppError('La contraseña actual es requerida', 400);

    const { rows } = await db.query<Pick<UserRow, 'password_hash'>>(
      'SELECT password_hash FROM users WHERE id = $1',
      [targetId],
    );
    if (rows.length === 0) throw new AppError('Usuario no encontrado', 404);

    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) throw new AppError('La contraseña actual es incorrecta', 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2 AND tenant_id = $3',
    [passwordHash, targetId, req.tenantId],
  );

  res.json({ message: 'Contraseña actualizada' });
}