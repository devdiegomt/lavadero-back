# ADR-0002 · Aislamiento multi-tenant por columna

**Estado:** Vigente
**Fecha:** 2026-08

## Contexto

Cada lavadero es un tenant y no debe ver los datos de ningún otro. Hay tres
formas habituales de aislar: base por tenant, esquema por tenant, o columna
`tenant_id` compartiendo tablas.

El producto apunta a lavaderos chicos, con un plan gratuito. Eso implica muchos
tenants con pocos datos cada uno.

## Decisión

**Columna `tenant_id`** en las tablas de negocio (11 de 15), y toda consulta la
incluye en el `WHERE`. El middleware `requireTenant` inyecta `req.tenantId`
desde el JWT.

## Alternativas descartadas

**Base de datos por tenant.** El aislamiento más fuerte: un error de código no
puede cruzar tenants. Pero cada alta implica crear una base y correr
migraciones, N conexiones abiertas, y una consulta agregada para el super admin
requiere unir N bases. Con un plan gratuito y muchos tenants chicos, no escala
operativamente.

**Esquema por tenant.** Punto intermedio, con los mismos problemas de
migración multiplicada por N y complejidad en el pool de conexiones.

**Row Level Security de PostgreSQL.** Habría dado la garantía en el motor en
vez de en la convención. Se descartó **por ahora**, no por siempre: implica
`SET LOCAL` por transacción y revisar las 78 rutas. Es la mitigación correcta a
largo plazo.

## Consecuencias

**A favor**

- Un alta de tenant es un `INSERT`
- Una migración se corre una vez
- Las consultas del super admin son un `GROUP BY`
- Un solo pool de conexiones

**En contra** — y es serio

- **Una consulta que olvide el `tenant_id` filtra datos entre lavaderos.** El
  aislamiento depende de la disciplina en cada consulta, no del motor.
- Todas las tablas crecen juntas
- Un `DELETE` mal escrito puede afectar a varios tenants

La única mitigación real hoy es la convención de escribir `tenant_id = $1` como
primer parámetro, y tests que verifican que un tenant ajeno reciba 404. No hay
nada que lo impida mecánicamente.

## Cuándo reconsiderar

- Si un tenant crece tanto que su volumen degrada a los demás
- Si aparece un requisito contractual de aislamiento físico
- **Si ocurre un incidente de filtración entre tenants** — ahí se implementa
  RLS de inmediato, sin discusión
