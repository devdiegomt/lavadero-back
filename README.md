# Carwash SaaS — Backend

API REST multi-tenant para gestión de lavaderos de autos en Colombia. Incluye facturación electrónica DIAN (Alegra), chatbot de WhatsApp con Claude AI, y panel de super-admin.

**Stack**: Node.js 20+ · Express · PostgreSQL · Redis · JWT · Pino · Helmet · Zod

---

## Índice

1. [Arquitectura](#arquitectura)
2. [Setup local](#setup-local)
3. [Variables de entorno](#variables-de-entorno)
4. [Scripts](#scripts)
5. [Migraciones y seeds](#migraciones-y-seeds)
6. [Levantar el chatbot de WhatsApp](#chatbot-whatsapp)
7. [Tests](#tests)
8. [Despliegue](#despliegue)
9. [Operación en producción](#operación-en-producción)
10. [Troubleshooting](#troubleshooting)

---

## Arquitectura

```
┌─────────────┐    ┌───────────────────────────────────────────┐
│  Frontend   │───▶│  Express API                              │
│  (Vite/PWA) │    │  ─────────                                │
└─────────────┘    │  • JWT auth + refresh rotation            │
                   │  • Multi-tenant (tenants.id en cada query)│
                   │  • PostgreSQL (datos) + Redis (sesiones)  │
                   │  • Cron jobs (reminders, retry billing)   │
                   └─────────┬─────────────────────────────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
   ┌───────┐           ┌──────────┐          ┌──────────┐
   │Alegra │           │   n8n    │          │ bot-wa   │
   │(DIAN) │◀──REST───│workflows │◀──HTTP──│ Baileys  │
   └───────┘           └─────┬────┘          └──────────┘
                             │
                       ┌─────▼─────┐
                       │  Claude   │
                       │   API     │
                       └───────────┘
```

**Módulos** (`src/modules/`): `auth`, `tenants`, `customers`, `vehicles`, `services`, `appointments`, `payments`, `billing`, `reports`, `history`, `users`, `onboarding`, `superadmin`, `whatsapp`. Cada uno con `*.controller.js` + `*.routes.js`.

**Multi-tenancy**: cada query incluye `WHERE tenant_id = $1`. El middleware `requireTenant` inyecta `req.tenantId` desde el JWT. El `super_admin` no tiene `tenant_id` y opera vía endpoints `/superadmin/*`.

---

## Setup local

### Requisitos

- Node.js 20+
- PostgreSQL 14+
- Redis 6+
- (Opcional) Docker + Docker Compose para WhatsApp y n8n

### Instalación

```bash
git clone https://github.com/devdiegomt/lavadero-back.git
cd lavadero-back

# Dependencias
npm install

# Variables de entorno
cp .env.example .env
# IMPORTANTE: regenera ENCRYPTION_KEY y JWT_SECRET, no uses los del ejemplo
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"

# Crear base de datos
createdb carwash_dev

# Migraciones (corre las 3 en orden)
npm run db:migrate-all

# Seed de datos iniciales (planes, super_admin, demo tenant)
npm run db:seed-superadmin
npm run db:seed

# Levantar el servidor en modo desarrollo (auto-reload con --watch)
npm run dev
```

El backend queda en `http://localhost:3000`. Health check: `GET /api/health`.

Credenciales por defecto del seed:
- Super admin: `superadmin@carwash-saas.com` / `super123!` (cambiables vía `.env`)
- Demo tenant admin: `admin@elbrillante.co` / `admin123`

> ⚠️ **Si vas a poner el repo público**, NO commitees el `.env`. El `.env.example` debe tener placeholders, nunca valores reales.

---

## Variables de entorno

Ver `.env.example` para la lista completa. Las críticas:

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | ✅ | Connection string de PostgreSQL |
| `REDIS_URL` | ✅ | Connection string de Redis |
| `JWT_SECRET` | ✅ | 64+ chars random. Cifra los access tokens |
| `ENCRYPTION_KEY` | ✅ | 64 hex chars. Cifra `billing_api_key` y otros datos sensibles. **No se puede perder** sin perder los datos cifrados |
| `CORS_ORIGIN` | ✅ | URL del frontend (ej. `https://app.tu-dominio.com`) |
| `RATE_LIMIT_MAX` | ⬜ | Default 100 req/15min por IP. En producción ajustar al uso |
| `STRICT_RATE_LIMIT_MAX` | ⬜ | Default 5 req/15min para `/auth/login` y `/onboarding/register` |
| `SENTRY_DSN` | ⬜ | Si está, activa Sentry. Si no, error tracking desactivado |
| `SENTRY_TRACES_SAMPLE_RATE` | ⬜ | 0.0–1.0. En prod usar 0.1 |
| `N8N_API_KEY` | Solo si usas WhatsApp | Header compartido entre n8n y backend |
| `ANTHROPIC_API_KEY` | Solo si usas WhatsApp | Para que n8n llame a Claude |

---

## Scripts

```bash
npm run dev                       # Servidor con auto-reload
npm run start                     # Servidor en producción
npm run db:migrate-all            # Corre las 3 migraciones (base + billing + multitenant)
npm run db:migrate                # Solo migración base
npm run db:migrate-billing        # Solo migración billing
npm run db:migrate-mt             # Solo migración multi-tenant
npm run db:seed                   # Datos demo
npm run db:seed-superadmin        # Crea el super_admin global
npm run db:demo                   # Seed + datos de demo más amplios
npm run db:encrypt-billing-keys   # Migra billing_api_key plaintext → cifrado (idempotente)
npm run encrypt -- "valor"        # Cifra un valor desde CLI (debug)
npm test                          # Jest + supertest
npm run test:watch                # Tests en watch mode
```

Adicionalmente:

```bash
node src/shared/db/rotate-encryption-key.js   # Rota ENCRYPTION_KEY (ver script para flujo)
```

---

## Migraciones y seeds

Las migraciones son **scripts manuales en JS**, no usan una librería. Cada uno:
- Es idempotente (si ya existe la tabla/columna, no falla).
- Imprime qué hace.
- Se corren en orden estricto: `migrate.js` → `migrate-billing.js` → `migrate-multitenant.js`.

Si quieres re-empezar de cero en local:

```bash
dropdb carwash_dev && createdb carwash_dev
npm run db:migrate-all
npm run db:seed-superadmin
npm run db:seed
```

---

## Chatbot WhatsApp

El bot vive en `bot-wa/` (subdirectorio) y se comunica con n8n + el backend.

### Flujo

```
Cliente → WhatsApp → bot-wa (Baileys) → n8n webhook
                                          ↓
                                    Claude API
                                          ↓
                       Backend (/api/wa-bridge/*) ← n8n
                                          ↓
                       bot-wa → WhatsApp → Cliente
```

### Levantar (Docker Compose)

```bash
# Asegúrate de tener TENANT_PHONE, N8N_API_KEY, ANTHROPIC_API_KEY en .env
docker compose up -d

# Ver el QR para vincular WhatsApp
docker compose logs -f bot-wa

# Importar el workflow en n8n: http://localhost:5678
# Archivo: n8n/workflows/whatsapp-main.json
```

Después de escanear el QR, el bot queda emparejado. La sesión persiste en un volumen de Docker; no hay que escanear de nuevo a menos que cierres sesión desde el celular.

---

## Tests

```bash
npm test          # Toda la suite (Jest + supertest)
npm run test:watch
```

La suite cubre los flujos críticos (TC-001 a TC-005): auth, multi-tenant isolation, FSM de turnos, generación de factura, rate limiting. Sin BD real (usa una de test que se reinicia entre suites).

---

## Despliegue

El backend está pensado para correr en Railway, Fly.io o cualquier PaaS con Postgres + Redis.

### Railway (recomendado)

1. New Project → Deploy from GitHub → seleccionar `lavadero-back`
2. Add → PostgreSQL → copiar `DATABASE_URL`
3. Add → Redis → copiar `REDIS_URL`
4. Variables → pegar todas las del `.env.example` con valores reales (regenerar `JWT_SECRET` y `ENCRYPTION_KEY`)
5. Variables → `NODE_ENV=production`
6. Settings → Custom start command: `npm run db:migrate-all && npm start`

Para WhatsApp y n8n, requieren persistent volumes y typicamente se despliegan aparte (un VPS pequeño con `docker compose` es suficiente).

---

## Operación en producción

Ver [`docs/OPS.md`](docs/OPS.md) para el runbook completo: monitoreo, backups, rotación de keys, incident response.

Resumen rápido:

- **Health check**: `GET /api/health` → 200 OK
- **Logs**: Pino JSON estructurado. En Railway/Fly se ven directo. Local: `npm run dev` los formatea con `pino-pretty`.
- **Errores**: Sentry (si `SENTRY_DSN` configurado). Solo captura 5xx, ignora 4xx (errores de validación esperados).
- **Rate limit**: 100 req/15min global, 5 req/15min en login y signup. Ajustable vía env.
- **Backups**: configurar en el proveedor de Postgres (Railway hace daily automático).
- **Rotación de `ENCRYPTION_KEY`**: usar `src/shared/db/rotate-encryption-key.js`. Hacer backup ANTES.

---

## Troubleshooting

**`Token inválido` después de logueado**
- El frontend probablemente tiene una versión vieja en localStorage. Hacer `localStorage.clear()` y re-login.

**`Tenant no identificado` en endpoints**
- Estás logueado como `super_admin` (sin tenantId) y golpeando un endpoint que requiere tenant. Usa `/api/superadmin/*` o loguéate como un admin de tenant.

**`ENCRYPTION_KEY no está configurada`**
- El backend no puede arrancar sin esta variable. Genera con: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

**bot-wa pide QR cada vez que arranca**
- El volumen de sesiones no está persistiendo. Verificar `docker-compose.yml` → `volumes: - bot-wa-auth:/app/auth`.

**Alegra rechaza facturas**
- Probar conexión desde el panel: Settings → Facturación → "Probar conexión". Si falla, verificar formato `email:token` y resolución DIAN activa.

**Rate limit en `/auth/login` me bloqueó**
- Espera 15 min o reinicia el backend (en dev). En prod, ajusta `STRICT_RATE_LIMIT_MAX` si es muy estricto para tu caso.

---

## Licencia

Privada. © Diego Mayorga / Fulcro.