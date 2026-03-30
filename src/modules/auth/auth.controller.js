const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../../shared/db');
const { AppError } = require('../../shared/middleware/errorHandler');

// ---------------------------------------------------------------------------
// Helpers JWT
// ---------------------------------------------------------------------------

function generateAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' }
  );
}

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email y contraseña son requeridos', 400);
  }

  // Buscar usuario por email (puede estar en cualquier tenant)
  const { rows } = await db.query(
    `SELECT u.*, t.name as tenant_name, t.slug as tenant_slug
     FROM users u
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.email = $1 AND u.is_active = true
     LIMIT 1`,
    [email.toLowerCase().trim()]
  );

  if (rows.length === 0) {
    throw new AppError('Credenciales inválidas', 401);
  }

  const user = rows[0];

  // Verificar contraseña
  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    throw new AppError('Credenciales inválidas', 401);
  }

  // Verificar que el tenant esté activo
  if (user.tenant_id) {
    const { rows: tenantRows } = await db.query(
      'SELECT is_active FROM tenants WHERE id = $1',
      [user.tenant_id]
    );
    if (tenantRows.length === 0 || !tenantRows[0].is_active) {
      throw new AppError('Tu cuenta de lavadero está desactivada', 403);
    }
  }

  // Generar tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();

  // Guardar refresh token (hash)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 días

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, hashToken(refreshToken), expiresAt]
  );

  // Actualizar last_login
  await db.query(
    'UPDATE users SET last_login_at = NOW() WHERE id = $1',
    [user.id]
  );

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      tenant: user.tenant_id ? {
        id: user.tenant_id,
        name: user.tenant_name,
        slug: user.tenant_slug,
      } : null,
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------
async function refresh(req, res) {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new AppError('Refresh token requerido', 400);
  }

  const tokenHash = hashToken(refreshToken);

  // Buscar token válido
  const { rows } = await db.query(
    `SELECT rt.*, u.email, u.tenant_id, u.role, u.first_name, u.last_name, u.is_active
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1
       AND rt.revoked_at IS NULL
       AND rt.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  if (rows.length === 0) {
    throw new AppError('Refresh token inválido o expirado', 401);
  }

  const tokenRow = rows[0];

  if (!tokenRow.is_active) {
    throw new AppError('Usuario desactivado', 403);
  }

  // Revocar el token usado (rotation)
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
    [tokenRow.id]
  );

  // Generar nuevos tokens
  const user = {
    id: tokenRow.user_id,
    tenant_id: tokenRow.tenant_id,
    role: tokenRow.role,
    email: tokenRow.email,
  };

  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, hashToken(newRefreshToken), expiresAt]
  );

  res.json({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  });
}

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
async function logout(req, res) {
  const { refreshToken } = req.body;

  if (refreshToken) {
    // Revocar token específico
    await db.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND user_id = $2',
      [hashToken(refreshToken), req.user.id]
    );
  } else {
    // Revocar todos los tokens del usuario
    await db.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [req.user.id]
    );
  }

  res.json({ message: 'Sesión cerrada' });
}

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
async function me(req, res) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.role,
            t.id as tenant_id, t.name as tenant_name, t.slug as tenant_slug,
            t.plan as tenant_plan
     FROM users u
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = $1`,
    [req.user.id]
  );

  if (rows.length === 0) {
    throw new AppError('Usuario no encontrado', 404);
  }

  const user = rows[0];
  res.json({
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    phone: user.phone,
    role: user.role,
    tenant: user.tenant_id ? {
      id: user.tenant_id,
      name: user.tenant_name,
      slug: user.tenant_slug,
      plan: user.tenant_plan,
    } : null,
  });
}

module.exports = { login, refresh, logout, me };
