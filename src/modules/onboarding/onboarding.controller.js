/**
 * Onboarding Controller — Registro de nuevos lavaderos (self-service)
 * 
 * Flujo:
 *   1. POST /api/onboarding/register — Crear tenant + admin en una operación
 *   2. POST /api/onboarding/services — Agregar servicios iniciales (opcional)
 *   3. POST /api/onboarding/complete — Marcar onboarding como completado
 *   4. GET  /api/onboarding/status   — Estado del onboarding del tenant actual
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../../shared/db');
const { AppError } = require('../../shared/middleware/errorHandler');

// ─────────────────────────────────────────────────────────────────────────
// POST /api/onboarding/register (PÚBLICO — no requiere auth)
// Crea tenant + admin user en una sola operación atómica.
// ─────────────────────────────────────────────────────────────────────────
async function register(req, res) {
  const {
    // Datos del lavadero
    businessName, nit, ownerName, phone, email, address, city,
    openingTime, closingTime, baysCount,
    // Datos del admin
    adminEmail, adminPassword, adminFirstName, adminLastName,
  } = req.body;

  // Validaciones
  if (!businessName || !phone || !adminEmail || !adminPassword || !adminFirstName) {
    throw new AppError('Nombre del negocio, teléfono, email, contraseña y nombre del admin son requeridos', 400);
  }
  if (adminPassword.length < 6) {
    throw new AppError('La contraseña debe tener al menos 6 caracteres', 400);
  }

  // Generar slug único
  const baseSlug = businessName
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 60);

  // Verificar unicidad del slug
  const { rows: existingSlugs } = await db.query(
    'SELECT slug FROM tenants WHERE slug LIKE $1',
    [`${baseSlug}%`]
  );
  let slug = baseSlug;
  if (existingSlugs.some(r => r.slug === slug)) {
    slug = `${baseSlug}-${existingSlugs.length + 1}`;
  }

  // Verificar que el email no esté en uso
  const { rows: existingUsers } = await db.query(
    'SELECT id FROM users WHERE email = $1',
    [adminEmail.toLowerCase().trim()]
  );
  if (existingUsers.length > 0) {
    throw new AppError('Ya existe una cuenta con ese email', 409);
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // 1. Crear tenant
    const { rows: tenantRows } = await client.query(
      `INSERT INTO tenants (name, slug, nit, owner_name, phone, email, address, city,
         opening_time, closing_time, bays_count, plan, trial_ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'free', NOW() + INTERVAL '14 days')
       RETURNING *`,
      [
        businessName.trim(), slug,
        nit?.trim() || null, ownerName?.trim() || null,
        phone.trim(), (email || adminEmail).trim().toLowerCase(),
        address?.trim() || null, city?.trim() || 'Bogotá',
        openingTime || '07:00', closingTime || '19:00',
        baysCount || 3,
      ]
    );
    const tenant = tenantRows[0];

    // 2. Crear admin user
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, phone, role)
       VALUES ($1, $2, $3, $4, $5, $6, 'admin')
       RETURNING id, email, first_name, last_name, role`,
      [
        tenant.id,
        adminEmail.toLowerCase().trim(),
        passwordHash,
        adminFirstName.trim(),
        adminLastName?.trim() || null,
        phone.trim(),
      ]
    );
    const admin = userRows[0];

    // 3. Log de onboarding
    await client.query(
      `INSERT INTO onboarding_log (tenant_id, step, metadata) VALUES ($1, 'tenant_created', $2)`,
      [tenant.id, JSON.stringify({ businessName, adminEmail })]
    );
    await client.query(
      `INSERT INTO onboarding_log (tenant_id, step) VALUES ($1, 'admin_created')`,
      [tenant.id]
    );

    await client.query('COMMIT');

    // 4. Generar token para el nuevo admin (auto-login después de registro)
    const accessToken = jwt.sign(
      { sub: admin.id, tenantId: tenant.id, role: admin.role, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' }
    );
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [admin.id, refreshHash, expiresAt]
    );

    res.status(201).json({
      message: 'Lavadero registrado exitosamente',
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        trialEndsAt: tenant.trial_ends_at,
      },
      user: {
        id: admin.id,
        email: admin.email,
        firstName: admin.first_name,
        lastName: admin.last_name,
        role: admin.role,
      },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/onboarding/services (AUTENTICADO)
// Agrega servicios iniciales predefinidos para el nuevo lavadero.
// ─────────────────────────────────────────────────────────────────────────
async function addDefaultServices(req, res) {
  const { services } = req.body;

  if (!Array.isArray(services) || services.length === 0) {
    // Usar servicios predeterminados colombianos
    const defaults = [
      { name: 'Lavado Básico', desc: 'Lavado exterior con agua, jabón y secado manual', sedan: 2500000, suv: 3500000, moto: 1500000, minutes: 30 },
      { name: 'Lavado Completo', desc: 'Lavado exterior + interior: aspirado, tablero y vidrios', sedan: 4000000, suv: 5500000, moto: 2500000, minutes: 60 },
      { name: 'Lavado Premium', desc: 'Lavado completo + encerado + protector de llantas', sedan: 6000000, suv: 7500000, moto: 4000000, minutes: 90 },
    ];

    for (let i = 0; i < defaults.length; i++) {
      const d = defaults[i];
      await db.query(
        `INSERT INTO services (tenant_id, name, description, price_sedan, price_suv, price_camioneta, price_moto, price_pickup, estimated_minutes, sort_order)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $5, $7, $8)`,
        [req.tenantId, d.name, d.desc, d.sedan, d.suv, d.moto, d.minutes, i + 1]
      );
    }

    await db.query(
      `INSERT INTO onboarding_log (tenant_id, step, metadata) VALUES ($1, 'services_added', $2)`,
      [req.tenantId, JSON.stringify({ count: defaults.length, type: 'default' })]
    );

    return res.status(201).json({ message: `${defaults.length} servicios predeterminados creados` });
  }

  // Servicios personalizados
  for (let i = 0; i < services.length; i++) {
    const s = services[i];
    await db.query(
      `INSERT INTO services (tenant_id, name, description, price_sedan, price_suv, price_camioneta, price_moto, price_pickup, estimated_minutes, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [req.tenantId, s.name, s.description || null,
       s.priceSedan || 0, s.priceSuv || 0, s.priceCamioneta || 0, s.priceMoto || 0, s.pricePickup || 0,
       s.estimatedMinutes || 60, i + 1]
    );
  }

  await db.query(
    `INSERT INTO onboarding_log (tenant_id, step, metadata) VALUES ($1, 'services_added', $2)`,
    [req.tenantId, JSON.stringify({ count: services.length, type: 'custom' })]
  );

  res.status(201).json({ message: `${services.length} servicios creados` });
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/onboarding/complete (AUTENTICADO)
// Marca el onboarding como completado.
// ─────────────────────────────────────────────────────────────────────────
async function complete(req, res) {
  await db.query(
    `INSERT INTO onboarding_log (tenant_id, step) VALUES ($1, 'completed')`,
    [req.tenantId]
  );

  res.json({ message: 'Onboarding completado', completed: true });
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/onboarding/status (AUTENTICADO)
// Retorna el estado del onboarding del tenant actual.
// ─────────────────────────────────────────────────────────────────────────
async function status(req, res) {
  const { rows: logs } = await db.query(
    'SELECT step, created_at FROM onboarding_log WHERE tenant_id = $1 ORDER BY created_at',
    [req.tenantId]
  );

  const steps = logs.map(l => l.step);
  const { rows: serviceCnt } = await db.query(
    'SELECT COUNT(*) FROM services WHERE tenant_id = $1 AND is_active = true',
    [req.tenantId]
  );
  const { rows: opCnt } = await db.query(
    "SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND role = 'operator' AND is_active = true",
    [req.tenantId]
  );

  res.json({
    steps: {
      tenantCreated: steps.includes('tenant_created'),
      adminCreated: steps.includes('admin_created'),
      servicesAdded: steps.includes('services_added') || parseInt(serviceCnt[0].count) > 0,
      completed: steps.includes('completed'),
    },
    servicesCount: parseInt(serviceCnt[0].count),
    operatorsCount: parseInt(opCnt[0].count),
    logs,
  });
}

module.exports = { register, addDefaultServices, complete, status };
