# ADR-0008 · Migraciones como scripts idempotentes

**Estado:** Vigente, con fecha de vencimiento
**Fecha:** 2026-08

## Contexto

El esquema evoluciona: se agregaron facturación, multi-tenancy con planes, e
identificación por LID. Cada cambio necesita aplicarse a bases existentes sin
perder datos.

## Decisión

**Scripts SQL idempotentes**, uno por tema, ejecutados en orden por
`npm run db:migrate-all`:

```
migrate.ts            → esquema base
migrate-billing.ts    → facturación
migrate-multitenant.ts→ planes y límites
migrate-wa-lid.ts     → identificación por LID
```

Todos usan `CREATE TABLE IF NOT EXISTS` y `ADD COLUMN IF NOT EXISTS`, así que
correrlos dos veces no rompe nada.

## Alternativas descartadas

**`node-pg-migrate` u otro framework.** Da versionado del esquema, `up`/`down`,
y una tabla de control que registra qué se aplicó. Se descartó **por ahora**:
con un desarrollador, un entorno de producción y cuatro migraciones, la
ceremonia supera al beneficio.

**Migraciones generadas por un ORM.** El proyecto no usa ORM: las consultas son
SQL directo con `pg`. Introducir uno por las migraciones sería la cola moviendo
al perro.

## Consecuencias

**A favor**

- Sin dependencia nueva
- El SQL se lee tal cual se ejecuta
- Idempotentes: correrlos de más es seguro

**En contra** — y es lo que le pone fecha de vencimiento

- **Sin control de versión del esquema.** No hay forma de saber qué migraciones
  se aplicaron a una base dada, más que inspeccionarla.
- **Sin rollback.** Un cambio equivocado se deshace a mano.
- **El orden es implícito**, vive en el `&&` de un script de npm.
- Con varios entornos, nada garantiza que todos estén en el mismo estado.

## Cuándo reconsiderar

Cualquiera de estos lo dispara:

- **Una segunda persona** tocando el esquema
- **Un entorno de staging** además de producción
- **Más de ocho migraciones** — el orden implícito deja de ser manejable
- **La primera vez que haga falta un rollback**

En ese momento, `node-pg-migrate` es la opción natural: usa SQL plano y puede
adoptar los scripts existentes como migración inicial.

## Nota operativa

La imagen de producción no incluye `ts-node`, así que hay dos variantes de cada
script: `db:migrate` (desarrollo, sobre `src/`) y `db:migrate:prod` (sobre
`dist/`). Al agregar una migración hay que crear **las dos**.
