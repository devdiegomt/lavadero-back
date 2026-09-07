# Decisiones de arquitectura (ADR)

Un ADR registra **por qué** se tomó una decisión, no sólo cuál fue. El código
muestra el resultado; esto muestra el razonamiento y las alternativas que se
descartaron.

## Cuándo escribir uno

Si la decisión cumple alguno de estos criterios:

- Es difícil de revertir
- Descarta una alternativa razonable
- Alguien va a preguntar "¿por qué está hecho así?"

## Regla

**Un ADR no se edita cuando la decisión cambia.** Se escribe uno nuevo que lo
reemplaza, y el viejo se marca como `Superado por ADR-XXXX`. El rastro de por
qué se cambió de opinión vale más que la foto actual.

## Índice

| # | Decisión | Estado |
|---|---|---|
| [0001](0001-monolito-modular.md) | Monolito modular en lugar de microservicios | Vigente |
| [0002](0002-multi-tenancy-por-columna.md) | Aislamiento multi-tenant por columna | Vigente |
| [0003](0003-baileys-vs-api-oficial.md) | Baileys en lugar de la API oficial de WhatsApp | Vigente |
| [0004](0004-n8n-como-orquestador.md) | n8n como capa conversacional | Vigente |
| [0005](0005-identidad-por-lid.md) | Identificar clientes de WhatsApp por su LID | Vigente |
| [0006](0006-ia-solo-para-clasificar.md) | La IA sólo clasifica intención | Vigente |
| [0007](0007-zona-horaria-del-tenant.md) | Los horarios se calculan en la zona del tenant | Vigente |
| [0008](0008-migraciones-sin-framework.md) | Migraciones como scripts idempotentes | Vigente, con fecha de vencimiento |

## Plantilla

```markdown
# ADR-XXXX · Título

**Estado:** Vigente | Superado por ADR-YYYY
**Fecha:** AAAA-MM

## Contexto
Qué problema había y qué restricciones aplicaban.

## Decisión
Qué se decidió, en una frase.

## Alternativas descartadas
Qué más se consideró y por qué no.

## Consecuencias
Lo bueno y lo malo. Especialmente lo malo.

## Cuándo reconsiderar
Qué tendría que pasar para volver a discutirlo.
```
