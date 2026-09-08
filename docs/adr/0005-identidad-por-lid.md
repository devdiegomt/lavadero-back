# ADR-0005 · Identificar clientes de WhatsApp por su LID

**Estado:** Vigente
**Fecha:** 2026-08

## Contexto

El sistema identificaba a los clientes por teléfono: `customers.phone`, con
`NOT NULL`. Encajaba con el panel, donde el operario escribe el número.

Al conectar el bot apareció el problema. WhatsApp multi-device entrega los
mensajes con un **LID** (`16733343588585@lid`) en vez del número. El LID es un
identificador interno, **no un teléfono**.

Se intentaron tres caminos para recuperar el número:

1. `key.senderPn` — el campo donde WhatsApp adjunta el teléfono
2. El JID directo, si venía como `@s.whatsapp.net`
3. Un mapa LID→teléfono construido con `contacts.upsert`

El diagnóstico en producción cerró la discusión. La key del mensaje trae
exactamente esto:

```json
{ "remoteJid": "16733343588585@lid", "fromMe": false, "id": "AC58CE8A..." }
```

Sin `senderPn` ni equivalente. Y `contacts.upsert` nunca dispara, así que el
mapa queda vacío. **El teléfono no está.**

Antes de eso, el código derivaba el "teléfono" del JID de respuesta, con lo
cual el backend recibía `+16733343588585` — un LID disfrazado de número, que
nunca coincidía con ningún cliente.

## Decisión

**El LID es el identificador** de los clientes que llegan por WhatsApp.

- `customers.wa_lid`, único por tenant
- `customers.phone` deja de ser obligatorio
- `CHECK (phone IS NOT NULL OR wa_lid IS NOT NULL)`
- La sesión de agendamiento se llavea por LID

## Alternativas descartadas

**Pedirle el número al cliente en la conversación.** Sin cambios de esquema,
pero agrega un paso a cada cliente nuevo, el número puede venir mal escrito, y
el historial sólo funciona si lo tipea igual que en la base.

**Guardar el LID en la columna `phone`.** Cero trabajo y máximo daño: corrompe
las búsquedas, y un cliente creado así queda con un "teléfono" al que nadie
puede llamar.

**No soportar identificación por WhatsApp.** Habría dejado historial y
agendamiento sin funcionar — dos de las cinco funciones del bot.

## Consecuencias

**A favor**

- Historial y agendamiento funcionan sin fricción para el cliente
- El LID es estable: el mismo usuario vuelve a caer en su registro
- Un cliente cargado desde el panel se enlaza con su WhatsApp la primera vez
  que escribe, en vez de duplicarse
- El teléfono deja de ser un dato inventado

**En contra**

- Un cliente puede quedar **sin teléfono**: no se le puede llamar
- Dos identificadores para la misma entidad, y toda búsqueda tiene que
  contemplar ambos
- El LID es opaco: no dice nada a un humano que lo lea
- Si WhatsApp cambia el esquema de LIDs, hay que revisarlo

## Nota de seguimiento (2026-09)

**`senderPn` ya no viene siempre vacío**, contra lo que decía este ADR cuando
se escribió. En una sesión de producción se observaron dos vías nuevas:

- `key.senderPn` presente en algunos mensajes entrantes
- una sincronización masiva de `contacts.upsert` que pobló el mapa LID→teléfono
  con cientos de contactos de golpe

**Pero no es fiable, y la decisión no cambia.** En la sesión siguiente, tras
reiniciar el bot, los mensajes del mismo remitente volvieron a llegar con
`lidMapSize: 0` y sin `senderPn`; la sincronización de contactos no se repitió.
Es decir: el teléfono llega *a veces*, para *algunos* remitentes, y nunca de
forma garantizada en el primer mensaje — que es justo cuando hace falta para
identificar al cliente.

Eso confirma el diseño en vez de desmentirlo: **el LID es el identificador, el
teléfono es enriquecimiento oportunista.** Lo que cambia es que ahora hay más
casos en los que el teléfono sí se puede completar, y conviene aprovecharlos.

Los volcados del mapa pasaron a `debug` y con el número enmascarado: a nivel
`info` dejaban cientos de teléfonos de terceros —contactos que no son clientes
del lavadero— en claro en los logs.

## Cuándo reconsiderar

- Si `senderPn` pasa a llegar de forma consistente en el **primer** mensaje de
  cada remitente, y no sólo a veces (ver la nota de seguimiento)
- Si aparece un requisito de contactar al cliente por fuera de WhatsApp — ahí
  hay que pedirle el número explícitamente
- Si se migra a la API oficial, que sí entrega el número
