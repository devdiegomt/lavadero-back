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

## Comprobado: los selectores nativos no funcionan (2026-09)

Surgió la pregunta de si se podía reemplazar el menú numerado —«escribe 1, 2,
3…»— por el selector nativo de WhatsApp, ese que aparece como una lista
tocable. **Se probó contra un teléfono real y la respuesta es no.**

Qué se envió, con Baileys 6.7.24, armando el mensaje a mano con
`generateWAMessageFromContent` + `relayMessage`:

| Formato | ¿WhatsApp aceptó el envío? | ¿Qué vio el destinatario? |
|---|---|---|
| `listMessage` | ✅ `ok: true` | *«Esperando mensaje. Esto puede tomar tiempo.»* |
| `buttonsMessage` | ✅ `ok: true` | *«Esperando mensaje. Esto puede tomar tiempo.»* |
| `interactiveMessage` (native flow) | ✅ `ok: true` | No llegó ni como marcador |

**La lección de método importa tanto como el resultado.** Los tres envíos
devolvieron éxito: el servidor de WhatsApp los aceptó sin protestar. Guiarse
por eso habría llevado a dar la función por buena. Lo que decide es lo que
renderiza la app de quien recibe, y eso sólo se ve mirando la pantalla.

No degradan a texto plano, que sería tolerable. Llegan **rotos**: el cliente ve
un mensaje fantasma que nunca se resuelve. En una conversación real es peor que
un menú numerado, porque parece que el negocio escribió algo ilegible.

Detalles que quedan documentados por si alguien reabre esto:

- El proto de Baileys **sí** trae los tres formatos; el problema no es la
  librería.
- Pero no los trata como algo de primera clase: en el generador de mensajes
  salientes, `buttonsMessage` sólo aparece al *leer* entrantes. Es un camino
  tolerado, no soportado.
- Si el selector llegara a renderizar, **el bot todavía ignoraría la
  respuesta**: `processMessage` sólo lee `conversation` y
  `extendedTextMessage`, y un toque llega como `listResponseMessage`. Habría
  que interpretarlo además de enviarlo.
- Enviar interactivos desde un cliente no oficial es de lo que más llama la
  atención de WhatsApp. Aunque funcionara, hay que pesar el riesgo sobre la
  línea del lavadero.

**Los selectores nativos son terreno de la API oficial**, donde List Messages y
Reply Buttons están documentados y soportados. Querer selects es, por tanto, un
argumento para migrar — no para forzar Baileys.

El código del experimento se borró: era desechable, la conclusión no.

## Cuándo reconsiderar

- Si el volumen justifica el costo por conversación de la API oficial
- **Si los selectores nativos pasan a ser un requisito** — hoy no se pueden
  hacer con Baileys, comprobado arriba
- Si WhatsApp bloquea el número, aunque sea una vez
- Si el cliente exige garantía contractual de disponibilidad
- Si el producto se vende a lavaderos más grandes, donde el costo pesa menos
  que la estabilidad

La separación en un proceso aparte con una interfaz acotada (recibe mensajes,
expone `POST /send`) hace que el reemplazo sea localizado: cambia `bot-wa`, no
el backend.
