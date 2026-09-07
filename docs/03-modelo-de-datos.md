# 03 · Modelo de datos

PostgreSQL, 15 tablas. Todos los identificadores son `UUID` con
`uuid_generate_v4()`.

## 1. Mapa

```
                        ┌──────────┐
                        │  plans   │
                        └────┬─────┘
                             │
                        ┌────▼─────┐
              ┌─────────┤ tenants  ├──────────┐
              │         └────┬─────┘          │
              │              │                │
       ┌──────▼───┐   ┌──────▼────┐   ┌───────▼──────┐
       │  users   │   │ customers │   │   services   │
       └────┬─────┘   └─────┬─────┘   └───────┬──────┘
            │               │                 │
            │         ┌─────▼─────┐           │
            │         │ vehicles  │           │
            │         └─────┬─────┘           │
            │               │                 │
            │         ┌─────▼─────────────────▼──┐
            └────────▶│      appointments        │
                      └─────┬──────────────┬─────┘
                            │              │
                  ┌─────────▼──┐    ┌──────▼──────────────┐
                  │  payments  │    │appointment_status_log│
                  └─────┬──────┘    └─────────────────────┘
                        │
                  ┌─────▼────────┐
                  │billing_errors│
                  └──────────────┘

  Sin relación directa con appointments:
  whatsapp_messages · billing_sync · tenant_usage · onboarding_log · refresh_tokens
```

## 2. La columna que está en casi todas

`tenant_id` aparece en 11 de las 15 tablas. Es el eje del aislamiento
multi-tenant y **toda consulta lo lleva en el `WHERE`**.

Las cuatro que no lo tienen:

| Tabla | Por qué |
|---|---|
| `plans` | Catálogo global de la plataforma |
| `refresh_tokens` | Cuelga de `users`, que ya tiene tenant |
| `appointment_status_log` | Cuelga de `appointments` |
| `billing_errors` | Tiene `tenant_id`, pero se accede por `payment_id` |

## 3. Tablas principales

### `tenants` — 27 columnas

El lavadero. Es la raíz de casi todo.

Grupos de columnas que conviene distinguir:

- **Identidad**: `name`, `slug`, `nit`, `owner_name`
- **Contacto**: `phone`, `email`, `address`, `city`
- **Operación**: `opening_time`, `closing_time`, `bays_count`, `timezone`
- **WhatsApp**: `whatsapp_phone`, `whatsapp_enabled`, `whatsapp_provider`
- **Facturación**: `billing_provider`, `billing_api_key` (ver [Seguridad §4](05-seguridad.md#4-datos-en-reposo))
- **Comercial**: `plan_id`, `is_active`

`timezone` no es decorativo: la disponibilidad de turnos se calcula en la hora
local del lavadero, no en la del servidor. Confundirlos causó un bug real —
ver [ADR-0007](adr/0007-zona-horaria-del-tenant.md).

`whatsapp_phone` es lo que usa el bridge para resolver el tenant. Tiene que
coincidir exactamente con el `TENANT_PHONE` de bot-wa.

### `customers` — 19 columnas

El cliente del lavadero.

```sql
phone           VARCHAR(20)      -- puede ser NULL
wa_lid          VARCHAR(40)      -- puede ser NULL
anonymized_at   TIMESTAMPTZ      -- puede ser NULL
CHECK (phone IS NOT NULL OR wa_lid IS NOT NULL OR anonymized_at IS NOT NULL)
```

**Dos identificadores, al menos uno obligatorio.** Es la consecuencia de que
WhatsApp no entregue el teléfono del remitente: un cliente que llega por el bot
tiene `wa_lid` y no tiene `phone`; uno cargado desde el panel, al revés. Cuando
se encuentra a alguien por teléfono que todavía no tiene LID, se le completa —
así no se duplica. Ver [ADR-0005](adr/0005-identidad-por-lid.md).

La tercera rama del `CHECK` es lo que hace posible anonimizar: un cliente
anonimizado no tiene ni teléfono ni LID, y sin esa salida la restricción lo
prohibiría. Ver [Seguridad §5](05-seguridad.md#retención).

`visit_count` y `last_visit_at` son denormalizaciones para no contar turnos en
cada consulta. `last_visit_at` es además lo que mide la inactividad para la
retención.

**Autorización de tratamiento** (Ley 1581):

```sql
consent_at      TIMESTAMPTZ      -- cuándo autorizó
consent_version VARCHAR(20)      -- qué texto aceptó
consent_source  VARCHAR(20)      -- whatsapp | panel | onboarding
```

Tres columnas y no un booleano porque la obligación no es que el titular haya
autorizado, sino poder **demostrar qué** autorizó. `NULL` significa sin
autorización registrada, no autorización negada.

`deleted_at` es **borrado lógico**: la fila permanece con todos sus datos. No
sirve como supresión — para eso está `anonymized_at`, que sí vacía los campos
personales.

### `appointments` — 19 columnas

El turno. La tabla con más movimiento.

```sql
scheduled_date  DATE NOT NULL
scheduled_time  TIME              -- opcional
price           INTEGER NOT NULL  -- centavos
status          VARCHAR(20) NOT NULL DEFAULT 'pending'
source          VARCHAR(20) DEFAULT 'walk_in'
```

**Fecha y hora en columnas separadas**, no un `TIMESTAMP`. Permite un turno con
fecha pero sin hora ("hoy, cuando pueda"), que es un caso real de un lavadero.
Al leer, cuando conviene, se compone: `(scheduled_date + scheduled_time)`.

**El precio se copia al turno**, no se lee del servicio. Si mañana suben la
tarifa, los turnos viejos conservan lo que se cobró. `NOT NULL` — omitirlo
grababa todo en cero, que fue un bug real.

Estados: `pending → in_progress → done → delivered`, y `cancelled` desde
cualquiera. Terminales: `delivered` y `cancelled`.

`source` distingue `walk_in` de `whatsapp` — permite medir cuánto aporta el bot.

### `services` — 14 columnas

Cinco columnas de precio, una por tipo de vehículo:

```sql
price_sedan, price_suv, price_camioneta, price_moto, price_pickup
```

No hay tabla de precios: son columnas fijas porque los tipos de vehículo son un
conjunto cerrado y estable. Si algún día hay que agregar uno, se agrega una
columna — más simple que una tabla de tarifas para cinco valores.

Todos los precios en **centavos** (`INTEGER`). `2500000` son $25.000 COP. Evita
los errores de redondeo de coma flotante en dinero.

### `whatsapp_messages` — 11 columnas

Auditoría de la conversación.

```sql
phone       VARCHAR(20)   -- puede ser NULL
wa_lid      VARCHAR(40)   -- puede ser NULL
direction   VARCHAR(10)   -- inbound | outbound | system
content     TEXT NOT NULL
flow_step   VARCHAR(50)   -- el intent, o 'kw:<intent>' si la IA no estaba
external_id VARCHAR(100)  -- ID del mensaje en WhatsApp
CHECK (phone IS NOT NULL OR wa_lid IS NOT NULL)
```

`external_id` cumple dos funciones: rastrear la fila hasta el mensaje concreto,
y **evitar duplicados** — el recordatorio usa `reminder:<appointment_id>`, que
es lo que impide que el cron de 5 minutos lo mande repetido.

`content` guarda el texto literal. Es el dato más sensible del sistema: el
cliente puede escribir cualquier cosa ahí.

### `refresh_tokens` — 6 columnas

```sql
token_hash  VARCHAR   -- SHA-256, nunca el token
expires_at  TIMESTAMPTZ
revoked_at  TIMESTAMPTZ
```

Sólo el hash. Quien lea la tabla no puede suplantar a nadie.

## 4. Tablas de soporte

| Tabla | Para qué |
|---|---|
| `plans` | Catálogo comercial: `free`, `basic`, `pro`, con sus límites |
| `tenant_usage` | Consumo mensual por tenant, para verificar límites |
| `onboarding_log` | Rastro del alta de un lavadero |
| `billing_sync` | Estado de sincronización con Alegra |
| `billing_errors` | Fallos de facturación pendientes de reintento |
| `appointment_status_log` | Quién cambió el estado de un turno y cuándo |
| `mv_daily_summary` | Vista materializada; se refresca cada 15 min |

## 5. Índices

39 índices. Los que más importan:

| Tabla | Índice | Para |
|---|---|---|
| `appointments` | `(tenant_id, scheduled_date, status)` | El tablero del día |
| `appointments` | `(tenant_id, status)` parcial | Turnos activos |
| `customers` | `(tenant_id, wa_lid)` único parcial | Identificación desde WhatsApp |
| `vehicles` | `(tenant_id, plate)` | Búsqueda por placa |
| `whatsapp_messages` | `(tenant_id, phone, created_at DESC)` | Historial de conversación |

Los índices parciales (`WHERE deleted_at IS NULL`) ahorran espacio y aceleran,
porque las filas borradas lógicamente no se consultan.

## 6. Migraciones

No hay framework de migraciones. Son scripts idempotentes que se corren en
orden:

```bash
npm run db:migrate            # esquema base
npm run db:migrate-billing    # facturación
npm run db:migrate-mt         # multi-tenant: planes y límites
npm run db:migrate-wa-lid     # identificación por LID
# o las cuatro:
npm run db:migrate-all
```

Todos usan `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, así que correrlos dos
veces no rompe nada.

**Limitación conocida:** no hay control de versión del esquema ni rollback. Con
un solo desarrollador alcanza; con más de uno, o con varios entornos, conviene
`node-pg-migrate`. Está anotado en [ADR-0008](adr/0008-migraciones-sin-framework.md).

Para escribir una migración nueva:

1. Un archivo en `src/shared/db/migrate-<tema>.ts`, copiando la forma de uno existente
2. SQL idempotente
3. Agregarlo a `db:migrate-all` y crear su variante `:prod` (que corre sobre `dist/`)
4. Probar dos veces seguidas sobre una base limpia

## 7. Datos de prueba

| Comando | Qué carga |
|---|---|
| `npm run db:seed` | 1 tenant, 3 usuarios, 5 servicios, 5 clientes, 6 vehículos |
| `npm run db:seed-superadmin` | El super admin de la plataforma |
| `npm run db:demo` | Lo anterior más 15 clientes y 28 turnos repartidos |
| `npm run db:reset` | Migraciones + seed, desde cero |

El seed toma `whatsapp_phone` de `TENANT_PHONE`. Si la variable falta, avisa —
sin eso, el bridge responde "Tenant no encontrado" a todo, y el síntoma no
señala al seed.
