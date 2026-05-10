/**
 * Validación y tipado de variables de entorno.
 *
 * Se importa como PRIMER módulo en src/index.ts.
 * Si alguna variable obligatoria falta o tiene formato incorrecto,
 * el proceso termina con exit(1) y mensajes claros ANTES de que
 * Express o la DB intenten arrancar.
 *
 * Uso:
 *   import { config } from '../config';   // desde un módulo
 *   import { config } from './config';    // desde index.ts
 *
 * NUNCA usar process.env directamente después de la migración a TS.
 * Todo acceso a env vars debe pasar por este objeto tipado.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de validación
// ─────────────────────────────────────────────────────────────────────────────

const postgresUrl = z
  .string()
  .refine(
    (v) => v.startsWith('postgresql://') || v.startsWith('postgres://'),
    'Debe empezar con postgresql:// o postgres://',
  );

const redisUrl = z
  .string()
  .refine((v) => v.startsWith('redis://') || v.startsWith('rediss://'), 'Debe empezar con redis:// o rediss://');

const hexKey = (bytes: number) =>
  z
    .string()
    .regex(
      new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`),
      `Debe ser exactamente ${bytes * 2} caracteres hex (${bytes} bytes). ` +
        `Generar con: node -e "console.log(require('crypto').randomBytes(${bytes}).toString('hex'))"`,
    );

const notPlaceholder = (hint: string) =>
  z.string().refine(
    (v) =>
      !v.includes('cambia-esto') &&
      !v.includes('change-this') &&
      !v.includes('genera-un') &&
      !v.includes('tu-token') &&
      !v.includes('xxx'),
    hint,
  );

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // ── Server ────────────────────────────────────────────────────────────────
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // ── Database ──────────────────────────────────────────────────────────────
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl.default('redis://localhost:6379'),

  // ── JWT ───────────────────────────────────────────────────────────────────
  JWT_SECRET: z
    .string()
    .min(32, 'Debe tener al menos 32 caracteres')
    .and(
      notPlaceholder(
        'JWT_SECRET tiene el valor placeholder. ' +
          "Genera uno con: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
      ),
    ),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  JWT_REFRESH_EXPIRES: z.string().default('7d'),

  // ── Encryption ────────────────────────────────────────────────────────────
  // ⚠️ Esta key es OBLIGATORIA para billing. Sin ella la app no puede
  //    cifrar/descifrar billing_api_key de los tenants.
  ENCRYPTION_KEY: hexKey(32),

  // ── CORS ─────────────────────────────────────────────────────────────────
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // ── Rate limiting ─────────────────────────────────────────────────────────
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000), // 15 min
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  STRICT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),

  // ── Super admin ──────────────────────────────────────────────────────────
  SUPER_ADMIN_EMAIL: z.string().email('SUPER_ADMIN_EMAIL inválido'),
  SUPER_ADMIN_PASSWORD: z.string().min(8, 'SUPER_ADMIN_PASSWORD debe tener mínimo 8 caracteres'),

  // ── WhatsApp / n8n (opcionales) ──────────────────────────────────────────
  TENANT_PHONE: z.string().optional(),
  N8N_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  N8N_AUTH_TOKEN: z.string().default(''),
  RECONNECT_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),

  N8N_WEBHOOK_URL_PUBLIC: z.string().optional(),
  N8N_HOST: z.string().default('localhost'),
  N8N_PROTOCOL: z.enum(['http', 'https']).default('http'),

  // ── Sentry (opcional) ────────────────────────────────────────────────────
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  SENTRY_RELEASE: z.string().optional(),

  // ── Misc ─────────────────────────────────────────────────────────────────
  TIMEZONE: z.string().default('America/Bogota'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Parse y salida en caso de error
// ─────────────────────────────────────────────────────────────────────────────

const result = envSchema.safeParse(process.env);

if (!result.success) {
  // eslint-disable-next-line no-console
  console.error('\n❌  Variables de entorno inválidas o faltantes:\n');
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    // eslint-disable-next-line no-console
    console.error(`   ${path}: ${issue.message}`);
  }
  // eslint-disable-next-line no-console
  console.error('\n💡  Revisa tu .env comparándolo con .env.example\n');
  process.exit(1);
}

export const config = result.data;

/** Tipo inferido de la configuración validada. */
export type Config = typeof config;

/** Helpers de acceso frecuente */
export const isProd = config.NODE_ENV === 'production';
export const isDev  = config.NODE_ENV === 'development';
export const isTest = config.NODE_ENV === 'test';