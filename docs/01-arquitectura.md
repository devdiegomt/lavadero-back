# 01 · Arquitectura

## 1. ¿Monolito o microservicios?

**Es un monolito modular con dos servicios satélite.** Ni una cosa ni la otra
en estado puro, y la distinción importa porque determina cómo se agrega
funcionalidad.

### El núcleo es un monolito

El backend (`lavadero-back`) es **un solo proceso, una sola base de datos, un
solo despliegue**. Sus 14 módulos —`auth`, `appointments`, `customers`,
`billing`…— comparten el pool de conexiones, el proceso y el ciclo de vida.
Cambiar `appointments` obliga a redesplegar `billing`.

Es modular en su organización, no en su despliegue:

```
src/modules/appointments/
├── appointments.controller.ts   ← lógica y acceso a datos
└── appointments.routes.ts       ← rutas y middleware
```

Cada módulo es un directorio con la misma forma, y esa uniformidad es lo que
hace que uno nuevo no requiera decisiones: se copia la estructura.

### Los satélites son procesos aparte

Dos piezas **sí** corren como procesos independientes, y por razones concretas,
no por seguir una moda arquitectónica:

**`bot-wa`** mantiene un WebSocket permanente con WhatsApp. Ese socket es
*stateful*: si el proceso reinicia, hay que reconectar, y si corren dos
instancias, WhatsApp cierra una. Meterlo dentro del backend significaría que
cada despliegue del API tumba la sesión de WhatsApp, y que no se puede escalar
el backend horizontalmente sin romper el bot. Por eso vive aparte.

**`n8n`** existe para poder cambiar el comportamiento conversacional sin
recompilar ni redesplegar el backend. Ajustar un texto, agregar una intención o
reordenar una rama se hace en su interfaz.

### La decisión, explícita

No se eligieron microservicios. Con **un solo desarrollador**, ningún módulo
con necesidad de escalar por separado, y una base de datos que todos comparten,
los microservicios agregarían despliegues, observabilidad distribuida,
consistencia eventual y latencia de red — a cambio de una independencia que
nadie necesita todavía.

El monolito modular deja la puerta abierta: si algún día un módulo justifica
separarse, la frontera ya está marcada por el directorio. Ver
[ADR-0001](adr/0001-monolito-modular.md).

**Cuándo reconsiderarlo.** Si aparece alguno de estos síntomas, vale releer el
ADR:

- Un módulo necesita escalar con un perfil muy distinto al resto
- Dos personas se pisan de forma sistemática en el mismo archivo
- Un despliegue se vuelve riesgoso porque toca todo a la vez
- Un módulo necesita otro lenguaje o motor de datos

Ninguno se cumple hoy.

## 2. Vista de componentes

```
                         ┌────────────────────┐
   Cliente final ───────▶│      bot-wa        │
   (WhatsApp)            │  Baileys · :3001   │
                         │  ─────────────     │
                         │  socket permanente │
                         │  POST /send        │
                         └─────────┬──────────┘
                                   │ HTTP
                                   ▼
                         ┌────────────────────┐      ┌─────────────┐
                         │        n8n         │─────▶│   Claude    │
                         │   workflow · :5678 │      │  Haiku 4.5  │
                         │  ─────────────     │◀─────│  clasifica  │
                         │  26 nodos          │      └─────────────┘
                         └─────────┬──────────┘
                                   │ /api/wa-bridge/*
                                   ▼
   Personal ──────────▶  ┌────────────────────┐      ┌─────────────┐
   (navegador)           │      Backend       │─────▶│   Alegra    │──▶ DIAN
        │                │  Express TS · :3000│      └─────────────┘
        │  /api/*        │  ─────────────     │
        └───────────────▶│  14 módulos        │
                         │  JWT · multi-tenant│
                         └────┬──────────┬────┘
                              ▼          ▼
                        ┌─────────┐  ┌────────┐
                        │PostgreSQL│ │ Redis  │
                        │  15 tablas│ │sesiones│
                        └──────────┘  └────────┘
```

### Responsabilidad de cada pieza

| Pieza | Es dueña de | No hace |
|---|---|---|
| **Backend** | Todo el estado, todas las reglas de negocio, autenticación, multi-tenancy | No habla con WhatsApp directamente |
| **bot-wa** | La sesión de WhatsApp y nada más | No consulta la base ni decide qué responder |
| **n8n** | Enrutar el mensaje y darle forma a la respuesta | No guarda estado entre mensajes |
| **Claude** | Convertir texto libre en una intención | No decide precios, disponibilidad ni nada de negocio |
| **Frontend** | Interfaz del personal | No tiene lógica de negocio propia |

La regla que mantiene esto ordenado: **el estado vive en el backend.** bot-wa
es un transporte; n8n es un enrutador. Si alguno de los dos necesitara recordar
algo entre mensajes, la respuesta correcta es guardarlo en el backend, no en el
satélite. Es lo que se hizo con las sesiones de agendamiento, que van a Redis
a través de un endpoint.

## 3. Flujo principal: un mensaje de WhatsApp

```
1. El cliente escribe "cuánto cuesta el lavado"
2. bot-wa lo recibe por el socket
   → extrae texto, LID del remitente, pushName
   → POST al webhook de n8n, y espera la respuesta
3. n8n pregunta al backend si hay un agendamiento en curso
   → si lo hay, el mensaje es la respuesta al paso anterior: se responde y termina
   → si no, sigue
4. n8n llama a Claude con el mensaje
   → devuelve { intent: "list_services", entities: { plate: null } }
5. El switch enruta por intención → rama de servicios
6. n8n consulta GET /api/wa-bridge/services
7. Un Code node arma el texto con esos datos
8. n8n responde al webhook
9. bot-wa envía el texto por WhatsApp
10. Después de responder, n8n registra el intercambio en la auditoría
```

Dos cosas que no son obvias y conviene tener presentes:

**El paso 3 va antes que Claude a propósito.** A mitad de un agendamiento, el
cliente contesta "ABC123" o "2" — son respuestas al paso anterior, no
intenciones nuevas. Clasificarlas daría `unknown` y rompería la conversación.

**El paso 10 va después de responder.** La auditoría no debe agregar latencia a
lo que el cliente está esperando.

## 4. El subsistema de WhatsApp

### Por qué tres piezas y no una

Se podría haber puesto todo en el backend: recibir el mensaje, clasificarlo,
responder. La separación se justifica así:

- **bot-wa aparte** porque el socket es stateful (ver §1).
- **n8n aparte** porque el comportamiento conversacional cambia seguido —
  textos, orden de las preguntas, una intención nueva— y no queremos que cada
  ajuste sea un despliegue del API.

El costo es real: son tres saltos de red y tres lugares donde mirar cuando algo
falla. Se paga a cambio de poder tocar la conversación sin tocar el backend.

### Estado de la conversación

n8n no guarda estado. El agendamiento necesita cuatro turnos (placa → servicio
→ horario → confirmación), así que el estado vive en **Redis**, con el LID del
cliente como clave y 10 minutos de expiración.

El backend expone `POST /api/wa-bridge/booking-step`, que recibe el mensaje,
avanza la máquina de estados y devuelve el siguiente texto. La lógica del flujo
está en `src/modules/whatsapp/flows/booking.js` — código determinista, sin IA.

### Degradación cuando Claude no está

Si la llamada a Claude falla —sin crédito, caída, timeout— el nodo de parseo
**no se rinde**: clasifica por palabras clave. Entiende menos, pero el bot sigue
respondiendo. El intent queda registrado con prefijo `kw:` en la auditoría, así
que una racha degradada se ve desde la base:

```sql
SELECT flow_step, count(*) FROM whatsapp_messages
WHERE flow_step LIKE 'kw:%' GROUP BY 1;
```

Esto no es paranoia: pasó en producción cuando se agotaron los créditos.

## 5. Multi-tenancy

**Aislamiento por columna**, no por esquema ni por base.

Cada tabla de negocio tiene `tenant_id`, y toda consulta lo incluye:

```sql
SELECT ... FROM appointments WHERE tenant_id = $1 AND ...
```

`req.tenantId` lo inyecta el middleware `requireTenant` desde el JWT. El
`super_admin` es la excepción: no tiene `tenant_id` y opera por `/api/superadmin/*`.

**El riesgo es evidente y hay que nombrarlo:** una consulta que olvide el
`tenant_id` filtra datos entre lavaderos. No hay Row Level Security de
PostgreSQL como red de seguridad — el aislamiento depende de la disciplina en
cada consulta. Ver [Seguridad §3](05-seguridad.md#3-aislamiento-multi-tenant) y
[ADR-0002](adr/0002-multi-tenancy-por-columna.md).

## 6. Patrones en uso

| Patrón | Dónde | Por qué |
|---|---|---|
| **Monolito modular** | `src/modules/` | §1 |
| **Cadena de middleware** | `authenticate` → `authorize` → `requireTenant` → handler | Cada capa una responsabilidad |
| **Máquina de estados** | `flows/booking.js` | Una conversación multi-turno es literalmente eso |
| **Validación en el borde** | Middleware Zod | Los datos entran validados o no entran |
| **Degradación con reserva** | Fallback por palabras clave | Un servicio externo caído no debe tumbar el producto |
| **Idempotencia por clave natural** | `external_id = 'reminder:<id>'` | Un cron que corre cada 5 min no puede mandar el mismo aviso repetido |
| **Configuración validada al arrancar** | `config.ts` con Zod | Fallar al arrancar es mejor que fallar en la primera petición |

**Anti-patrones que se evitaron**, y vale decir por qué:

- **IA decidiendo lógica de negocio** — precios y disponibilidad son
  deterministas. Ver [ADR-0006](adr/0006-ia-solo-para-clasificar.md).
- **Estado en el satélite** — bot-wa y n8n son sin estado; todo va al backend.
- **Microservicios prematuros** — §1.

## 7. Decisiones registradas

| ADR | Decisión |
|---|---|
| [0001](adr/0001-monolito-modular.md) | Monolito modular en lugar de microservicios |
| [0002](adr/0002-multi-tenancy-por-columna.md) | Aislamiento por `tenant_id` |
| [0003](adr/0003-baileys-vs-api-oficial.md) | Baileys en lugar de la API oficial de WhatsApp |
| [0004](adr/0004-n8n-como-orquestador.md) | n8n como capa conversacional |
| [0005](adr/0005-identidad-por-lid.md) | Identificar clientes por LID |
| [0006](adr/0006-ia-solo-para-clasificar.md) | La IA sólo clasifica |
