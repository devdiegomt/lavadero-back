# ADR-0003 · Baileys en lugar de la API oficial de WhatsApp

**Estado:** Vigente
**Fecha:** 2026-08

## Contexto

El bot necesita recibir y enviar mensajes de WhatsApp. Hay dos caminos: la
**API oficial de WhatsApp Business** (vía Meta o un proveedor como Twilio o
360dialog), o una **librería no oficial** que habla el protocolo de WhatsApp
Web, como Baileys.

El destinatario del producto es un lavadero chico en Colombia, con márgenes
ajustados y sin equipo técnico.

## Decisión

**Baileys** (`@whiskeysockets/baileys`), en un proceso aparte que mantiene el
socket con WhatsApp.

## Alternativas descartadas

**API oficial de WhatsApp Business.** Es la opción correcta desde el punto de
vista de cumplimiento y estabilidad: contrato, soporte, sin riesgo de bloqueo.
Se descartó por el costo de entrada. Requiere verificación de empresa,
aprobación de plantillas de mensaje, y un costo por conversación que para un
lavadero que atiende pocos clientes al día no cierra. Además, las plantillas
aprobadas previamente encajan mal con una conversación de agendamiento libre.

**Twilio.** El código heredado tiene un `sender.js` con soporte para Twilio,
del diseño anterior. Mismo problema de costo, más una capa de intermediación.

## Consecuencias

**A favor**

- Sin costo por mensaje
- Sin proceso de aprobación: se vincula escaneando un QR
- Conversación libre, sin plantillas
- El lavadero usa el número que ya tiene

**En contra** — y hay que asumirlo con los ojos abiertos

- **No es oficial.** WhatsApp puede bloquear el número. El riesgo es real y no
  hay recurso si pasa.
- La sesión se cae y hay que revincular escaneando un QR
- Baileys sigue cambios no documentados del protocolo; una actualización de
  WhatsApp puede romper la librería
- **No entrega el número de teléfono del remitente** — ver [ADR-0005](0005-identidad-por-lid.md)
- No hay soporte al que reclamar

Las mitigaciones implementadas: el bot detecta la desvinculación, limpia las
credenciales y genera un QR nuevo sin intervención; `/health` reporta el estado
del vínculo.

## Cuándo reconsiderar

- Si el volumen justifica el costo por conversación de la API oficial
- Si WhatsApp bloquea el número, aunque sea una vez
- Si el cliente exige garantía contractual de disponibilidad
- Si el producto se vende a lavaderos más grandes, donde el costo pesa menos
  que la estabilidad

La separación en un proceso aparte con una interfaz acotada (recibe mensajes,
expone `POST /send`) hace que el reemplazo sea localizado: cambia `bot-wa`, no
el backend.
