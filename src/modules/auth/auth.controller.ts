import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { config } from '../../config';
import type { JwtPayload, LoginResponseDto, AuthUserDto } from '../../types/api';
import type { UserRow, TenantRow } from '../../types/entities';

// ─── Helpers JWT ─────────────────────────────────────────────────────────────

interface UserForToken {
  id: string;
  tenant_id: string | null;
  role: UserRow['role'];
  email: string;
}

function generateAccessToken(user: UserForToken): string {
  const payload: JwtPayload = {
    sub: user.id,
    tenantId: user.tenant_id,
    role: user.role,
    email: user.email,
  };
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES as unknown as number,
  });
}

function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Login ───────────────────────────────────────────────────────────────────

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email: string; password: string };

  type LoginRow = UserRow & {
    tenant_name: string | null;
    tenant_slug: string | null;
  };

  const { rows } = await db.query<LoginRow>(
    `SELECT u.*, t.name AS tenant_name, t.slug AS tenant_slug
     FROM users u
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.email = $1 AND u.is_active = true
     LIMIT 1`,
    [email.toLowerCase().trim()],
  );

  if (rows.length === 0) throw new AppError('Credenciales inválidas', 401);
  const user = rows[0];

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) throw new AppError('Credenciales inválidas', 401);

  if (user.tenant_id) {
    const { rows: tenantRows } = await db.query<Pick<TenantRow, 'is_active'>>(
      'SELECT is_active FROM tenants WHERE id = $1',
      [user.tenant_id],
    );
    if (tenantRows.length === 0 || !tenantRows[0].is_active) {
      throw new AppError('Tu cuenta de lavadero está desactivada', 403);
    }
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await db.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [user.id, hashToken(refreshToken), expiresAt],
  );

  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  const response: LoginResponseDto = {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      role: user.role,
      tenant: user.tenant_id
        ? { id: user.tenant_id, name: user.tenant_name!, slug: user.tenant_slug!, plan: 'free' as const }
        : null,
    },
  };
  res.json(response);
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as { refreshToken: string };
  if (!refreshToken) throw new AppError('Refresh token requerido', 400);

  const tokenHash = hashToken(refreshToken);

  type RefreshRow = {
    id: string; user_id: string; email: string;
    tenant_id: string | null; role: UserRow['role'];
    first_name: string; last_name: string | null; is_active: boolean;
  };

  const { rows } = await db.query<RefreshRow>(
    `SELECT rt.*, u.email, u.tenant_id, u.role, u.first_name, u.last_name, u.is_active
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > NOW()
     LIMIT 1`,
    [tokenHash],
  );

  if (rows.length === 0) throw new AppError('Refresh token inválido o expirado', 401);
  const tokenRow = rows[0];
  if (!tokenRow.is_active) throw new AppError('Usuario desactivado', 403);

  await db.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [tokenRow.id]);

  const userForToken: UserForToken = {
    id: tokenRow.user_id,
    tenant_id: tokenRow.tenant_id,
    role: tokenRow.role,
    email: tokenRow.email,
  };

  const newAccessToken = generateAccessToken(userForToken);
  const newRefreshToken = generateRefreshToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await db.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userForToken.id, hashToken(newRefreshToken), expiresAt],
  );

  res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
}

// ─── Logout ──────────────────────────────────────────────────────────────────

export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as { refreshToken?: string };

  if (refreshToken) {
    await db.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND user_id = $2',
      [hashToken(refreshToken), req.user!.id],
    );
  } else {
    await db.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [req.user!.id],
    );
  }

  res.json({ message: 'Sesión cerrada' });
}

// ─── Me ──────────────────────────────────────────────────────────────────────

export async function me(req: Request, res: Response): Promise<void> {
  type MeRow = {
    id: string; email: string; first_name: string; last_name: string | null;
    phone: string | null; role: UserRow['role'];
    tenant_id: string | null; tenant_name: string | null;
    tenant_slug: string | null; tenant_plan: TenantRow['plan'] | null;
  };

  const { rows } = await db.query<MeRow>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.role,
            t.id AS tenant_id, t.name AS tenant_name,
            t.slug AS tenant_slug, t.plan AS tenant_plan
     FROM users u
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = $1`,
    [req.user!.id],
  );

  if (rows.length === 0) throw new AppError('Usuario no encontrado', 404);
  const user = rows[0];

  const response: AuthUserDto = {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    phone: user.phone,
    role: user.role,
    tenant: user.tenant_id
      ? { id: user.tenant_id, name: user.tenant_name!, slug: user.tenant_slug!, plan: user.tenant_plan! }
      : null,
  };
  res.json(response);
}