# 00 · Visión general

## Qué es

Un SaaS multi-tenant para lavaderos de autos en Colombia. Cada lavadero es un
*tenant*: tiene sus propios clientes, vehículos, servicios, precios y usuarios,
y no ve los datos de ningún otro.

El producto cubre el ciclo completo de un turno: el cliente pide, se agenda, se
lava, se cobra, se factura ante la DIAN. Y lo hace por dos vías distintas —el
panel web que usa el personal, y WhatsApp, donde escribe el cliente final.

## Qué problema resuelve

Un lavadero chico opera con cuaderno y WhatsApp personal. Eso trae tres
problemas concretos:

- **No hay historial.** Nadie sabe cuántas veces vino un cliente ni qué se le
  hizo al carro la vez pasada.
- **El teléfono no para.** "¿Ya está listo?", "¿cuánto cuesta el completo?",
  "¿tienen turno hoy?" — preguntas repetidas que interrumpen el trabajo.
- **Facturar es manual.** La DIAN exige factura electrónica y hacerlas a mano
  no escala.

El sistema ataca los tres: la base de datos guarda el historial, el bot de
WhatsApp responde las preguntas repetidas sin intervención humana, y la
integración con Alegra emite las facturas.

## Actores

| Actor | Cómo entra | Qué hace |
|---|---|---|
| **Cliente final** | WhatsApp | Consulta estado y precios, agenda turnos, ve su historial |
| **Operario** | Panel web | Mueve turnos por el tablero, registra pagos |
| **Administrador** | Panel web | Todo lo del operario, más clientes, servicios, precios, reportes y facturación |
| **Super admin** | Panel web (`/admin`) | Opera la plataforma: alta de tenants, planes, límites. No pertenece a ningún tenant |

El cliente final **nunca toca el panel**. Su única interfaz es WhatsApp, y esa
asimetría explica varias decisiones de diseño: el bot tiene que ser tolerante a
mensajes mal escritos, y no puede asumir que el cliente sepa su número de turno
ni ninguna referencia interna.

## Las piezas

```
┌──────────────┐         ┌──────────────┐
│  Cliente     │         │  Personal    │
│  (WhatsApp)  │         │  (navegador) │
└──────┬───────┘         └──────┬───────┘
       │                        │
       ▼                        ▼
┌──────────────┐         ┌──────────────┐
│   bot-wa     │         │   Frontend   │
│  (Baileys)   │         │ (React SPA)  │
└──────┬───────┘         └──────┬───────┘
       │                        │
       ▼                        │
┌──────────────┐                │
│     n8n      │                │
│  (workflow)  │                │
└──────┬───────┘                │
       │                        │
       │   ┌────────────────────┘
       ▼   ▼
┌─────────────────────┐      ┌──────────┐
│      Backend        │─────▶│  Alegra  │──▶ DIAN
│   (Express + TS)    │      └──────────┘
└──────┬──────────────┘
       │
   ┌───┴────┐
   ▼        ▼
┌──────┐ ┌───────┐
│ PgSQL│ │ Redis │
└──────┘ └───────┘
```

Cinco procesos propios y dos servicios externos:

| Pieza | Qué es | Por qué existe separada |
|---|---|---|
| **Backend** | API REST en Express + TypeScript | El núcleo. Todo el estado y todas las reglas de negocio |
| **Frontend** | SPA React + Vite | Interfaz del personal |
| **bot-wa** | Proceso Node con Baileys | Mantiene un WebSocket permanente con WhatsApp; no puede vivir dentro de un proceso HTTP que escala o reinicia |
| **n8n** | Orquestador visual | Decide qué hacer con cada mensaje, sin recompilar el backend |
| **Claude** | API de Anthropic (Haiku 4.5) | Convierte texto libre en una intención de un conjunto cerrado |
| **Alegra** | API externa | Emite la factura electrónica ante la DIAN |

El detalle de cómo se reparten el trabajo y por qué está en
[Arquitectura](01-arquitectura.md).

## Qué hace la IA, y qué no

Vale aclararlo temprano porque es una fuente habitual de malentendidos.

Claude hace **una sola cosa**: leer el mensaje del cliente y devolver una
intención de una lista cerrada de siete, más la placa si aparece. La respuesta
está restringida por un esquema JSON, así que no puede devolver otra cosa.

**Ninguna** de estas cosas pasa por la IA:

- Precios · vienen de `services.price_sedan`, `price_suv`, etc.
- Disponibilidad · se calcula con el horario y el número de bahías del tenant
- Creación de turnos · es un `INSERT` en una transacción
- Estados de una orden · es una columna
- Datos del cliente · es una consulta

Los textos que recibe el cliente tampoco los redacta Claude: son plantillas que
se rellenan con datos de la base.

La prueba de que la separación es real: cuando se acabaron los créditos de la
API, un fallback por palabras clave mantuvo el bot funcionando. Si la IA
estuviera decidiendo precios o disponibilidad, eso habría sido imposible.

Ver [ADR-0006](adr/0006-ia-solo-para-clasificar.md).

## Glosario

| Término | Significado |
|---|---|
| **Tenant** | Un lavadero. La unidad de aislamiento de datos |
| **Turno** (*appointment*) | Una cita: cliente + vehículo + servicio + fecha y hora |
| **Bahía** (*bay*) | Puesto físico de lavado. Determina cuántos turnos simultáneos entran |
| **Placa** | Patente del vehículo. En Colombia: 3 letras + 3 números (carros) o 3 letras + 2 números (motos) |
| **LID** | Identificador interno de WhatsApp (`16733343588585@lid`). **No es un teléfono** — ver [ADR-0005](adr/0005-identidad-por-lid.md) |
| **Intent** | Lo que el cliente quiere, de un conjunto cerrado de siete |
| **wa-bridge** | Los endpoints del backend que consume n8n (`/api/wa-bridge/*`) |
| **Plan** | Nivel comercial del tenant (`free`, `basic`, `pro`). Define límites |

## Alcance

**Implementado y en uso:**
turnos, clientes, vehículos, servicios y precios por tipo de vehículo, pagos,
reportes, facturación vía Alegra, multi-tenancy con planes y límites, panel de
super admin, y el bot de WhatsApp con consulta de estado, precios, historial y
agendamiento conversacional.

**No implementado** (aparece en este documento sólo para delimitar):
cancelación de turnos desde WhatsApp, pagos en línea, descuentos y promociones,
inventario de insumos, y notificaciones push al personal.

Lo pendiente está en [Requerimientos §3](02-requerimientos.md#3-fuera-de-alcance-por-ahora).
