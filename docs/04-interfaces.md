# 04 · Diseño de interfaces

Tres superficies distintas, con reglas distintas:

1. **API pública** (`/api/*`) — la consume el panel web. JWT.
2. **API interna** (`/api/wa-bridge/*`) — la consume n8n. Clave compartida.
3. **API del bot** (`bot-wa:3001`) — la consume el backend. Token compartido.

Que estén separadas no es casual: cada una tiene un consumidor, un modelo de
autenticación y un contrato distintos. Mezclarlas obligaría a que el bot
entienda de JWT o que el panel conozca los LIDs.

## 1. API pública

`https://<host>/api`

### Autenticación

```http
Authorization: Bearer <access_token>
```

15 minutos de vida. Vencido, se renueva con `POST /api/auth/refresh`.

### Convenciones

| Aspecto | Regla |
|---|---|
| Formato | JSON en petición y respuesta |
| Nombres de campo | `snake_case`, igual que las columnas |
| Fechas | ISO 8601. `scheduled_date` es `YYYY-MM-DD`, `scheduled_time` es `HH:MM` |
| Dinero | Enteros en **centavos**. `2500000` = $25.000 |
| Identificadores | UUID v4 |
| Paginación | `?page` y `?limit` donde aplica |

### Códigos de estado

| Código | Cuándo |
|---|---|
| 200 | OK |
| 201 | Creado |
| 400 | Entrada inválida |
| 401 | Sin token o vencido |
| 403 | Autenticado pero sin permiso |
| 404 | No existe, o no es de tu tenant |
| 409 | Conflicto (ej. pago duplicado) |
| 429 | Límite de peticiones |
| 500 | Error del servidor |

**404 y no 403 cuando el recurso es de otro tenant.** Un 403 confirmaría que el
ID existe, y eso ya filtra información.

### Forma del error

```json
{ "error": "Mensaje legible para el usuario" }
```

Sin stack traces ni detalles internos. Lo técnico va al log, con el `requestId`
que emite `pino` para poder correlacionar.

### Endpoints

78 en 14 módulos. Los agrupados por recurso:

<details>
<summary><strong>auth</strong> (4)</summary>

| Método | Ruta | Rol |
|---|---|---|
| POST | `/auth/login` | público |
| POST | `/auth/refresh` | público |
| POST | `/auth/logout` | autenticado |
| GET | `/auth/me` | autenticado |
</details>

<details>
<summary><strong>appointments</strong> (7)</summary>

| Método | Ruta | Nota |
|---|---|---|
| GET | `/appointments` | filtros por fecha y estado |
| GET | `/appointments/today` | el tablero |
| GET | `/appointments/:id` | |
| POST | `/appointments` | |
| PATCH | `/appointments/:id` | |
| PATCH | `/appointments/:id/status` | valida la transición |
| POST | `/appointments/quick` | sólo con placa |
</details>

<details>
<summary><strong>customers</strong> (7) · <strong>vehicles</strong> (7)</summary>

CRUD estándar, más:

| Método | Ruta |
|---|---|
| GET | `/customers/:id/vehicles` |
| GET | `/customers/:id/history` |
| GET | `/vehicles/plate/:plate` |
| GET | `/vehicles/:id/history` |
</details>

<details>
<summary><strong>services</strong> (5) · <strong>payments</strong> (4) · <strong>reports</strong> (5)</summary>

| Método | Ruta |
|---|---|
| GET/POST/PATCH | `/services`, `/services/:id`, `/services/:id/toggle` |
| GET/POST | `/payments`, `/payments/summary`, `/payments/:id` |
| GET | `/reports/dashboard`, `/revenue`, `/services`, `/customers`, `/operators` |
</details>

<details>
<summary><strong>billing</strong> (9)</summary>

| Método | Ruta |
|---|---|
| POST | `/billing/invoice/:paymentId` |
| GET | `/billing/invoice/:paymentId` |
| POST | `/billing/retry/:paymentId` |
| POST | `/billing/credit-note/:paymentId` |
| GET | `/billing/invoices`, `/pending`, `/config` |
| POST | `/billing/config/test`, `/sync-services` |
</details>

<details>
<summary><strong>tenants</strong> (5) · <strong>users</strong> (5) · <strong>onboarding</strong> (4) · <strong>superadmin</strong> (8) · <strong>history</strong> (3)</summary>

| Método | Ruta |
|---|---|
| GET/PATCH | `/tenants/me`, `/me/stats`, `/me/operators`, `/me/usage` |
| GET/POST/PATCH | `/users`, `/users/:id`, `/:id/toggle`, `/:id/password` |
| POST/GET | `/onboarding/register`, `/services`, `/complete`, `/status` |
| GET/PATCH/PUT | `/superadmin/tenants`, `/plans`, … |
| GET | `/history/vehicle/:plate`, `/customer/:id`, `/search` |
</details>

## 2. API interna: wa-bridge

`/api/wa-bridge/*` — la consume **n8n**, nunca el navegador.

### Autenticación

```http
x-api-key: <N8N_API_KEY>
x-tenant-phone: +573001234567
```

Dos cabeceras con roles distintos: la clave autentica a n8n, y el teléfono
resuelve **qué tenant** es. No hay JWT porque no hay usuario: es una máquina
hablando con otra.

Si `x-tenant-phone` no coincide con ningún `tenants.whatsapp_phone`, responde
404 y ninguna rama del bot funciona. Es una fuente frecuente de confusión,
porque el error señala al backend cuando la causa suele estar en la
configuración del bot.

### Endpoints

| Método | Ruta | Devuelve |
|---|---|---|
| GET | `/appointment-status?plate=ABC123` | `{ found, appointment }` |
| GET | `/services` | `{ services[] }` con los cinco precios |
| GET | `/customer-history?waLid=…` o `?phone=…` | `{ found, customer, history[] }` |
| POST | `/book` | Crea un turno de una sola vez |
| POST | `/booking-step` | Avanza la conversación de agendamiento |
| POST | `/log` | Registra un mensaje en la auditoría |

### `POST /booking-step`

El más particular, porque mantiene estado.

```jsonc
// Petición
{
  "waLid": "16733343588585@lid",  // o "phone"
  "message": "ABC123",
  "start": false                   // true sólo al iniciar
}

// Sin conversación en curso
{ "active": false }

// Conversación avanzando
{ "active": true, "done": false, "step": "awaiting_service", "reply": "…" }

// Conversación terminada
{ "active": true, "done": true, "reply": "🎉 ¡Turno agendado!" }
```

`{ "active": false }` es lo que le dice a n8n *"este mensaje no es parte de una
conversación, clasificalo con Claude"*. Por eso el workflow llama a este
endpoint **antes** que a la IA.

La sesión vive en Redis con el LID como clave y 10 minutos de expiración.

## 3. API del bot

`bot-wa:3001` — la consume el **backend**, para mensajes que él inicia
(recordatorios). Las respuestas a un cliente no pasan por acá: las resuelve n8n
dentro del mismo intercambio.

| Método | Ruta | Auth |
|---|---|---|
| GET | `/health` | ninguna |
| POST | `/send` | `x-bot-token: <BOT_WA_SEND_TOKEN>` |

```jsonc
// POST /send
{ "to": "16733343588585@lid", "message": "⏰ Recordatorio…" }
```

`to` es un JID: el LID del cliente, o un número que se completa a
`<numero>@s.whatsapp.net`.

**Sin `BOT_WA_SEND_TOKEN` el endpoint queda deshabilitado (503), no abierto.**
Cualquiera que alcance el puerto podría mandar mensajes desde el número del
negocio, así que la ausencia de configuración se resuelve cerrando, no
permitiendo.

### `GET /health`

Además del estado, responde qué código está corriendo:

```jsonc
{
  "status": "ok",
  "state": "connected",        // starting | awaiting_qr | connected | reconnecting | logged_out
  "qrPending": false,
  "linkedPhone": "+573143347357",   // el número vinculado de verdad
  "tenantPhone": "+573143347357",   // el configurado — si difieren, el backend dará 404
  "build": "2026-08-22T01:14:33Z",  // cuándo se compiló
  "startedAt": "2026-08-22T01:17:20Z"
}
```

`linkedPhone` vs `tenantPhone` y `build` existen por experiencia: sin ellos, la
única forma de saber si el contenedor tiene el código actual era buscar en los
logs una línea que debería haber aparecido.

## 4. Frontend

SPA en React 18 + Vite + React Router, TypeScript.

```
src/
├── pages/        13 páginas, una por ruta
├── components/   reutilizables
├── layouts/      estructura común
├── hooks/        lógica compartida
├── lib/          api.ts — cliente HTTP
└── types/        tipos compartidos
```

### Rutas

| Ruta | Página | Acceso |
|---|---|---|
| `/login`, `/signup` | Login, Signup | público |
| `/board` | Tablero del día | autenticado |
| `/appointments`, `/customers`, `/payments`, `/history` | Gestión | autenticado |
| `/billing`, `/reports`, `/settings` | Administración | admin |
| `/admin` | Panel de plataforma | super_admin |

### Cliente HTTP

`src/lib/api.ts` centraliza todas las llamadas: agrega el `Authorization`,
renueva el token cuando vence, y redirige al login si el refresh falla.

**Los tokens se guardan en `localStorage`.** Es simple y sobrevive al recargar,
pero queda expuesto a XSS. Es la brecha #8 de
[Seguridad §7](05-seguridad.md#7-brechas-abiertas) — con su costo anotado,
porque migrar a cookies `httpOnly` arrastra protección CSRF.

## 5. Al agregar un endpoint

1. Ruta en `<modulo>.routes.ts`, con `authenticate` + `requireTenant` + `authorize`
2. Handler en `<modulo>.controller.ts`
3. Validación Zod del cuerpo y los parámetros
4. `WHERE tenant_id = $1` en toda consulta
5. Test de integración: caso feliz, sin permiso, y tenant ajeno
6. Agregarlo a la tabla de este documento
