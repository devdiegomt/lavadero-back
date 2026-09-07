# ADR-0006 · La IA sólo clasifica intención

**Estado:** Vigente
**Fecha:** 2026-08

## Contexto

El bot usa un modelo de lenguaje (Claude Haiku 4.5) para entender lo que
escribe el cliente. La pregunta era **hasta dónde** dejarlo llegar.

Un extremo posible: darle acceso a los datos y que él componga la respuesta
—"el lavado completo cuesta $25.000 y tenés turno a las 3"— con herramientas
para consultar y agendar. Es lo que muchos productos hacen hoy.

## Decisión

**Claude hace una sola cosa**: leer el mensaje y devolver una intención de una
lista cerrada de siete, más la placa si aparece.

La respuesta está restringida con `output_config.format` a este esquema:

```json
{
  "intent": "greeting | check_status | list_services | customer_history |
             book_appointment | human_help | unknown",
  "entities": { "plate": "…|null", "customerName": "…|null",
                "serviceKeyword": "…|null" }
}
```

Todo lo demás —precios, disponibilidad, creación de turnos, estados,
descuentos, datos del cliente— sale de consultas SQL y de código determinista.
Los textos que recibe el cliente son plantillas rellenadas con datos de la
base; no los redacta el modelo.

## Alternativas descartadas

**Agente con herramientas.** Darle a Claude funciones para consultar precios,
ver disponibilidad y crear turnos. Más flexible y conversacionalmente más
natural. Se descartó por tres razones:

1. **Un precio equivocado es un problema comercial.** Un modelo puede
   alucinar una cifra; una consulta SQL no.
2. **Sin la IA, no queda nada.** Si el modelo no responde, el bot no puede ni
   decir un precio.
3. **Costo y latencia.** Cada turno de conversación pasaría por el modelo
   varias veces.

**Sin IA, sólo palabras clave.** Más simple y determinista, pero frágil: el
cliente escribe "oe ya esta listo el carrito?" y ningún conjunto razonable de
palabras clave cubre las variantes.

## Consecuencias

**A favor**

- El precio que se dice es el que está en la base. Siempre.
- La disponibilidad respeta el horario y las bahías reales
- Un turno se crea en una transacción, con las validaciones del backend
- **Degradación posible**: si la IA no está, palabras clave mantienen el bot
  vivo
- Costo acotado: una llamada por mensaje, 512 tokens de salida
- El comportamiento es auditable — el intent queda en `whatsapp_messages`

**En contra**

- La conversación es más rígida. El bot no improvisa ni responde algo fuera de
  las siete intenciones
- Agregar una capacidad implica código, no sólo prompt
- Un mensaje que combina dos intenciones ("hola, cuánto cuesta y tenés turno")
  se resuelve por una sola

## La prueba de que funciona

Cuando se agotaron los créditos de la API, Claude empezó a devolver 400. El
fallback por palabras clave mantuvo el bot respondiendo saludos, precios,
asesor y consultas por placa.

Si el modelo hubiera estado decidiendo precios o disponibilidad, esa
degradación habría sido imposible: no hay palabra clave que reemplace a un
agente con herramientas.

## Nota

`serviceKeyword` y `customerName` se extraen y **hoy no los consume nadie**. Es
trabajo que el modelo hace y se descarta. Conviene sacarlos del esquema.

## Cuándo reconsiderar

- Si aparece un caso de uso que requiera conversación genuinamente abierta
- Si las siete intenciones se quedan cortas y agregar más deja de escalar
- Si el costo de la clasificación deja de ser el factor limitante

Aun así, la regla que conviene conservar: **lo que tenga consecuencia comercial
—precio, disponibilidad, compromiso— no lo decide el modelo.**
