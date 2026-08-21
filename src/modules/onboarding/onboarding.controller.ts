import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { config } from '../../config';
import type { OnboardingRegisterBody } from '../../shared/middleware/validate';
import type { JwtPayload } from '../../types/api';
import type { UserRole } from '../../types/entities';

// ─── POST /api/onboarding/register (PÚBLICO) ─────────────────────────────────

export async function register(req: Request, res: Response): Promise<void> {
  const {
    businessName, nit, ownerName, phone, email, address, city,
    openingTime, closingTime, baysCount,
    adminEmail, adminPassword, adminFirstName, adminLastName,
  } = req.body as OnboardingRegisterBody;

  // Generar slug con collision-safe suffix
  const baseSlug = businessName
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);

  let slug = baseSlug;
  const { rows: collisions } = await db.query<{ id: string }>(
    'SELECT 1 FROM tenants WHERE slug = $1 LIMIT 1',
    [slug],
  );
  if (collisions.length > 0) {
    slug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;
  }

  const { rows: existing } = await db.query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [adminEmail.toLowerCase().trim()],
  );
  if (existing.length > 0) throw new AppError('Ya existe una cuenta con ese email', 409);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    type TenantRow = { id: string; name: string; slug: string; plan: string; trial_ends_at: Date };

    const { rows: tenantRows } = await client.query<TenantRow>(
      `INSERT INTO tenants (name, slug, nit, owner_name, phone, email, address, city,
         opening_time, closing_time, bays_count, plan, trial_ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'free', NOW() + INTERVAL '14 days')
       RETURNING id, name, slug, plan, trial_ends_at`,
      [
        businessName.trim(), slug,
        nit?.trim() ?? null, ownerName?.trim() ?? null,
        phone.trim(), (email ?? adminEmail).trim().toLowerCase(),
        address?.trim() ?? null, city?.trim() ?? 'Bogotá',
        openingTime ?? '07:00', closingTime ?? '19:00', baysCount ?? 3,
      ],
    );
    const tenant = tenantRows[0];

    type AdminRow = { id: string; email: string; first_name: string; last_name: string | null; role: UserRole };

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const { rows: userRows } = await client.query<AdminRow>(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, phone, role)
       VALUES ($1, $2, $3, $4, $5, $6, 'admin')
       RETURNING id, email, first_name, last_name, role`,
      [tenant.id, adminEmail.toLowerCase().trim(), passwordHash,
       adminFirstName.trim(), adminLastName?.trim() ?? null, phone.trim()],
    );
    const admin = userRows[0];

    await client.query(
      `INSERT INTO onboarding_log (tenant_id, step, metadata) VALUES ($1, 'tenant_created', $2)`,
      [tenant.id, JSON.stringify({ businessName, adminEmail })],
    );
    await client.query(
      `INSERT INTO onboarding_log (tenant_id, step) VALUES ($1, 'admin_created')`,
      [tenant.id],
    );

    await client.query('COMMIT');

    // Auto-login: generar tokens para el nuevo admin
    const payload: JwtPayload = { sub: admin.id, tenantId: tenant.id, role: admin.role, email: admin.email };
    const accessToken = jwt.sign(payload, config.JWT_SECRET, {
      expiresIn: config.JWT_ACCESS_EXPIRES as unknown as number,
    });
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshHash  = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + 7);

    await db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [admin.id, refreshHash, expiresAt],
    );

    res.status(201).json({
      message: 'Lavadero registrado exitosamente',
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, plan: tenant.plan, trialEndsAt: tenant.trial_ends_at },
      user:   { id: admin.id, email: admin.email, firstName: admin.first_name, lastName: admin.last_name, role: admin.role },
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

// ─── POST /api/onboarding/services ───────────────────────────────────────────

type ServiceInput = {
  name: string; description?: string | null;
  priceSedan?: number; priceSuv?: number; priceCamioneta?: number;
  priceMoto?: number; pricePickup?: number; estimatedMinutes?: number;
};

const DEFAULTS: Array<ServiceInput & { estimatedMinutes: number }> = [
  { name: 'Lavado Básico',    description: 'Lavado exterior con agua, jabón y secado manual', priceSedan: 2_500_000, priceSuv: 3_500_000, priceMoto: 1_500_000, estimatedMinutes: 30 },
  { name: 'Lavado Completo',  description: 'Lavado exterior + interior: aspirado, tablero y vidrios',  priceSedan: 4_000_000, priceSuv: 5_500_000, priceMoto: 2_500_000, estimatedMinutes: 60 },
  { name: 'Lavado Premium',   description: 'Lavado completo + encerado + protector de llantas', priceSedan: 6_000_000, priceSuv: 7_500_000, priceMoto: 4_000_000, estimatedMinutes: 90 },
];

export async function addDefaultServices(req: Request, res: Response): Promise<void> {
  const { services } = req.body as { services?: ServiceInput[] };

  if (!Array.isArray(services) || services.length === 0) {
    for (let i = 0; i < DEFAULTS.length; i++) {
      const d = DEFAULTS[i];
      await db.query(
        `INSERT INTO services (tenant_id, name, description, price_sedan, price_suv, price_camioneta, price_moto, price_pickup, estimated_minutes, sort_order)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $5, $7, $8)`,
        [req.tenantId, d.name, d.description, d.priceSedan, d.priceSuv, d.priceMoto, d.estimatedMinutes, i + 1],
      );
    }
    await db.query(
      `INSERT INTO onboarding_log (tenant_id, step, metadata) VALUES ($1, 'services_added', $2)`,
      [req.tenantId, JSON.stringify({ count: DEFAULTS.length, type: 'default' })],
    );
    res.status(201).json({ message: `${DEFAULTS.length} servicios predeterminados creados` });
    return;
  }

  for (let i = 0; i < services.length; i++) {
    const s = services[i];
    await db.query(
      `INSERT INTO services (tenant_id, name, description, price_sedan, price_suv, price_camioneta, price_moto, price_pickup, estimated_minutes, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [req.tenantId, s.name, s.description ?? null,
       s.priceSedan ?? 0, s.priceSuv ?? 0, s.priceCamioneta ?? 0, s.priceMoto ?? 0, s.pricePickup ?? 0,
       s.estimatedMinutes ?? 60, i + 1],
    );
  }
  await db.query(
    `INSERT INTO onboarding_log (tenant_id, step, metadata) VALUES ($1, 'services_added', $2)`,
    [req.tenantId, JSON.stringify({ count: services.length, type: 'custom' })],
  );
  res.status(201).json({ message: `${services.length} servicios creados` });
}

// ─── POST /api/onboarding/complete ───────────────────────────────────────────

export async function complete(req: Request, res: Response): Promise<void> {
  await db.query(
    `INSERT INTO onboarding_log (tenant_id, step) VALUES ($1, 'completed')`,
    [req.tenantId],
  );
  res.json({ message: 'Onboarding completado', completed: true });
}

// ─── GET /api/onboarding/status ──────────────────────────────────────────────

export async function status(req: Request, res: Response): Promise<void> {
  const [{ rows: logs }, { rows: serviceCnt }, { rows: opCnt }] = await Promise.all([
    db.query<{ step: string; created_at: Date }>(
      'SELECT step, created_at FROM onboarding_log WHERE tenant_id = $1 ORDER BY created_at',
      [req.tenantId],
    ),
    db.query<{ count: string }>(
      'SELECT COUNT(*) FROM services WHERE tenant_id = $1 AND is_active = true',
      [req.tenantId],
    ),
    db.query<{ count: string }>(
      "SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND role = 'operator' AND is_active = true",
      [req.tenantId],
    ),
  ]);

  const steps = logs.map((l) => l.step);
  res.json({
    steps: {
      tenantCreated: steps.includes('tenant_created'),
      adminCreated:  steps.includes('admin_created'),
      servicesAdded: steps.includes('services_added') || parseInt(serviceCnt[0].count, 10) > 0,
      completed:     steps.includes('completed'),
    },
    servicesCount:  parseInt(serviceCnt[0].count, 10),
    operatorsCount: parseInt(opCnt[0].count, 10),
    logs,
  });
}