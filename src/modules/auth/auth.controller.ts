import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { config } from '../../config';
import type { JwtPayload, LoginResponseDto, AuthUserDto } from '../../types/api';
import {
  ponerRefreshEnCookie,
  borrarRefreshCookie,
  leerRefreshToken,
} from './cookies';
import { hashPassword } from '../../shared/utils/password';
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

  // El refresh token va en una cookie httpOnly: el JavaScript de la página no la
  // puede leer, así que un XSS no se lleva siete días de sesión renovable.
  ponerRefreshEnCookie(res, refreshToken);

  const response: LoginResponseDto = {
    accessToken,
    // Devolverlo en el cuerpo invita a guardarlo en localStorage, que es la
    // brecha entera. Sólo se hace si AUTH_REFRESH_IN_BODY lo pide, y eso existe
    // nada más para no dejar sin sesión a un frontend viejo durante el
    // despliegue. Ver modules/auth/cookies.ts.
    ...(config.AUTH_REFRESH_IN_BODY ? { refreshToken } : {}),
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
  // De la cookie, no del cuerpo. El cuerpo se sigue aceptando como transición
  // para un frontend viejo; ver `leerRefreshToken`.
  const refreshToken = leerRefreshToken(req);
  if (!refreshToken) throw new AppError('Refresh token requerido', 400);

  const tokenHash = hashToken(refreshToken);

  type RefreshRow = {
    id: string; user_id: string; email: string;
    tenant_id: string | null; role: UserRow['role'];
    first_name: string; last_name: string | null; is_active: boolean;
    /** Del lavadero, no del usuario. `null` para el superadministrador. */
    tenant_activo: boolean | null;
  };

  const { rows } = await db.query<RefreshRow>(
    `SELECT rt.*, u.email, u.tenant_id, u.role, u.first_name, u.last_name, u.is_active,
            t.is_active AS tenant_activo
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > NOW()
     LIMIT 1`,
    [tokenHash],
  );

  if (rows.length === 0) throw new AppError('Refresh token inválido o expirado', 401);
  const tokenRow = rows[0];
  if (!tokenRow.is_active) throw new AppError('Usuario desactivado', 403);

  // El login comprobaba el lavadero y esto no, así que desactivar uno sólo
  // frenaba a quien **todavía no había entrado**. Los que ya estaban adentro
  // seguían trabajando y renovando la sesión indefinidamente: el refresh dura
  // siete días y rota en cada uso, así que la suspensión no les llegaba nunca.
  //
  // Comprobado contra la API: con el lavadero desactivado, sus rutas seguían
  // respondiendo 200 y `POST /auth/refresh` devolvía un token nuevo. Desactivar
  // es la palanca para falta de pago o abuso — justo la población que ya está
  // usando el sistema, que era la única a la que no alcanzaba.
  //
  // Con esto, el corte llega en cuanto vence el access token que tengan: 15
  // minutos como mucho. `authenticate` no consulta la base a propósito —sólo
  // verifica el JWT— y meterle una consulta por petición costaría más de lo que
  // ahorra esa ventana.
  //
  // `LEFT JOIN`: el superadministrador no tiene tenant, y `null` no es `false`.
  if (tokenRow.tenant_activo === false) {
    throw new AppError('Tu cuenta de lavadero está desactivada', 403);
  }

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

  // La rotación también rota la cookie: si alguien robó la anterior, deja de
  // servir en cuanto el dueño legítimo renueva.
  ponerRefreshEnCookie(res, newRefreshToken);

  res.json({
    accessToken: newAccessToken,
    ...(config.AUTH_REFRESH_IN_BODY ? { refreshToken: newRefreshToken } : {}),
  });
}

// ─── Logout ──────────────────────────────────────────────────────────────────

export async function logout(req: Request, res: Response): Promise<void> {
  const refreshToken = leerRefreshToken(req);

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

  // Sin esto el navegador conserva la cookie y la sesión "cerrada" se puede
  // reanudar con un refresh. La fila ya está revocada, así que no serviría, pero
  // dejar una credencial muerta en el navegador no tiene ninguna ventaja.
  borrarRefreshCookie(res);

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
// ─── Cambiar la contraseña propia ────────────────────────────────────────────

/**
 * `PATCH /api/auth/password` — cualquier usuario cambia la suya.
 *
 * Ya existía `PATCH /api/users/:id/password`, pero vive bajo `requireTenant` y
 * filtra por `tenant_id`. El **superadministrador no tiene tenant**, así que esa
 * ruta le devuelve `400 Tenant no identificado`: la cuenta con más poder del
 * sistema era la única que no podía rotar su credencial, y se creaba con una
 * contraseña escrita en el README. Eso se descubrió recreando la base de
 * producción, con esa cuenta ya viva en una API accesible desde internet.
 *
 * Esta ruta no necesita tenant porque no lo necesita para nada: opera sobre
 * `req.user.id`, que sale de un token ya verificado. Siempre pide la contraseña
 * actual — no hay caso de "un admin le cambia la contraseña a otro" acá; para
 * eso sigue estando la ruta de `users`.
 *
 * **Revoca todas las sesiones**, incluida la de quien la llama. Si se cambia una
 * contraseña es porque puede estar comprometida, y dejar vivas las sesiones
 * abiertas con la anterior deja entrar a quien la tuviera durante siete días
 * más. El precio es tener que volver a entrar.
 */
export async function cambiarPropiaPassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };

  const { rows } = await db.query<Pick<UserRow, 'password_hash'>>(
    'SELECT password_hash FROM users WHERE id = $1',
    [req.user!.id],
  );
  if (rows.length === 0) throw new AppError('Usuario no encontrado', 404);

  const correcta = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!correcta) throw new AppError('La contraseña actual es incorrecta', 400);

  if (currentPassword === newPassword) {
    throw new AppError('La contraseña nueva tiene que ser distinta de la actual', 400);
  }

  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
    await hashPassword(newPassword),
    req.user!.id,
  ]);

  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [req.user!.id],
  );
  borrarRefreshCookie(res);

  res.json({
    message: 'Contraseña actualizada. Todas las sesiones se cerraron; entra de nuevo.',
  });
}
