const bcrypt = require('bcryptjs');
const db = require('../../shared/db');
const { AppError } = require('../../shared/middleware/errorHandler');

// GET /api/users
async function list(req, res) {
  const { rows } = await db.query(
    `SELECT id, email, first_name, last_name, phone, role, is_active, last_login_at, created_at
     FROM users
     WHERE tenant_id = $1
     ORDER BY
       CASE role WHEN 'admin' THEN 1 WHEN 'operator' THEN 2 ELSE 3 END,
       first_name`,
    [req.tenantId]
  );
  res.json(rows);
}

// POST /api/users
async function create(req, res) {
  const { email, password, firstName, lastName, phone, role } = req.body;

  if (!email || !password || !firstName) {
    throw new AppError('Email, contraseña y nombre son requeridos', 400);
  }
  if (password.length < 6) {
    throw new AppError('La contraseña debe tener al menos 6 caracteres', 400);
  }

  const validRoles = ['admin', 'operator'];
  const userRole = validRoles.includes(role) ? role : 'operator';

  const passwordHash = await bcrypt.hash(password, 10);

  const { rows } = await db.query(
    `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, phone, role)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email, first_name, last_name, phone, role, is_active, created_at`,
    [req.tenantId, email.toLowerCase().trim(), passwordHash,
     firstName.trim(), lastName?.trim() || null, phone?.trim() || null, userRole]
  );

  res.status(201).json(rows[0]);
}

// PATCH /api/users/:id
async function update(req, res) {
  const { firstName, lastName, phone, email, role } = req.body;

  // No permitir editarse a sí mismo el rol
  if (req.params.id === req.user.id && role) {
    throw new AppError('No puedes cambiar tu propio rol', 400);
  }

  const fieldMap = {
    firstName: 'first_name', lastName: 'last_name',
    phone: 'phone', email: 'email', role: 'role',
  };

  const updates = [];
  const values = [];
  let idx = 1;

  for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
    const val = { firstName, lastName, phone, email, role }[jsKey];
    if (val !== undefined) {
      updates.push(`${dbKey} = $${idx}`);
      values.push(dbKey === 'email' ? val.toLowerCase().trim() : val);
      idx++;
    }
  }

  if (updates.length === 0) throw new AppError('No hay campos para actualizar', 400);

  values.push(req.params.id, req.tenantId);
  const { rows } = await db.query(
    `UPDATE users SET ${updates.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1}
     RETURNING id, email, first_name, last_name, phone, role, is_active`,
    values
  );

  if (rows.length === 0) throw new AppError('Usuario no encontrado', 404);
  res.json(rows[0]);
}

// PATCH /api/users/:id/toggle
async function toggle(req, res) {
  // No permitir desactivarse a sí mismo
  if (req.params.id === req.user.id) {
    throw new AppError('No puedes desactivar tu propia cuenta', 400);
  }

  const { rows } = await db.query(
    `UPDATE users SET is_active = NOT is_active
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, first_name, is_active`,
    [req.params.id, req.tenantId]
  );
  if (rows.length === 0) throw new AppError('Usuario no encontrado', 404);
  res.json(rows[0]);
}

// PATCH /api/users/:id/password
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  const targetId = req.params.id;

  // Solo admin puede cambiar password de otro usuario sin verificar la actual
  const isSelf = targetId === req.user.id;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';

  if (!isSelf && !isAdmin) {
    throw new AppError('No tienes permisos para cambiar esta contraseña', 403);
  }

  if (!newPassword || newPassword.length < 6) {
    throw new AppError('La nueva contraseña debe tener al menos 6 caracteres', 400);
  }

  // Si es el propio usuario, verificar la contraseña actual
  if (isSelf) {
    if (!currentPassword) throw new AppError('La contraseña actual es requerida', 400);

    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [targetId]);
    if (rows.length === 0) throw new AppError('Usuario no encontrado', 404);

    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) throw new AppError('La contraseña actual es incorrecta', 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2 AND tenant_id = $3',
    [passwordHash, targetId, req.tenantId]
  );

  res.json({ message: 'Contraseña actualizada' });
}

module.exports = { list, create, update, toggle, changePassword };
