# ADR-0004 · n8n como capa conversacional

**Estado:** Vigente
**Fecha:** 2026-08

## Contexto

Entre recibir un mensaje de WhatsApp y responderlo hay que decidir qué quiere
el cliente, consultar datos y armar un texto. Eso podía vivir dentro del
backend o en una pieza aparte.

El comportamiento conversacional es lo que más cambia: el texto de un mensaje,
el orden de las preguntas, una intención nueva. Cada ajuste como despliegue del
API es fricción alta para cambios de bajo riesgo.

## Decisión

**n8n** como orquestador: recibe el mensaje por webhook, llama a Claude,
enruta por intención, consulta al backend y devuelve el texto.

## Alternativas descartadas

**Todo en el backend.** Menos piezas y un solo lugar donde depurar. Se descartó
porque cada cambio de texto sería un despliegue, y porque la lógica de ruteo
conversacional en código se vuelve un `switch` largo que nadie quiere tocar.

**Un motor de diálogo dedicado** (Rasa, Dialogflow). Más potentes, pero traen
su propio modelo de entrenamiento e intenciones. Con siete intenciones fijas y
Claude clasificando, sería complejidad sin uso.

## Consecuencias

**A favor**

- Cambiar un texto o agregar una rama no toca el backend
- El flujo se ve como grafo, lo que ayuda a razonarlo
- Cada ejecución queda registrada con el detalle de cada nodo — fue decisivo
  para depurar más de una vez

**En contra**

- **Tres saltos de red** entre el mensaje y la respuesta
- Tres lugares donde mirar cuando algo falla
- El workflow vive en un JSON que se importa a mano; **no se despliega con el
  código**, lo que ya causó confusión al correr una versión vieja sin notarlo
- n8n no guarda estado entre webhooks: el agendamiento multi-turno obligó a
  poner la sesión en Redis, a través de un endpoint del backend
- Los nodos IF y Switch tienen un esquema propio que hay que respetar; un nodo
  malformado hace fallar el workflow entero antes de responder

## Mitigaciones

- El workflow está versionado en `n8n/workflows/whatsapp-main.json`
- `__tests__/n8n-workflow.test.ts` lo recorre nodo por nodo contra el backend
  real, verificando URLs, headers y ramas
- Los nodos HTTP tienen `onError: continueRegularOutput`, así un backend caído
  produce una disculpa y no silencio

**Límite conocido de esa prueba:** el intérprete implementa la semántica que
escribimos, no los esquemas de nodo de n8n. Un nodo que n8n rechaza puede pasar
el test. Pasó.

## Cuándo reconsiderar

- Si la latencia de los tres saltos se vuelve un problema
- Si el workflow crece tanto que el grafo deja de ser legible
- Si el desfase entre el JSON del repositorio y lo cargado en n8n sigue
  causando incidentes
- Si el comportamiento conversacional se estabiliza y deja de cambiar — ahí
  la flexibilidad deja de pagar su costo
