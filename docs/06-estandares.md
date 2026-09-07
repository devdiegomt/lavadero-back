# 06 · Estándares de código

Convenciones del proyecto. Están escritas porque una convención que sólo vive
en la cabeza de quien escribió el código deja de existir cuando llega otro.

## 1. Lenguaje

**TypeScript con `strict: true`** en backend y frontend.

`any` no se usa. Cuando el tipo es genuinamente desconocido —el cuerpo de una
petición, la respuesta de un servicio externo— se usa `unknown` y se estrecha:

```ts
// mal
const data: any = await res.json();
return data.appointment.id;

// bien
const data: unknown = await res.json();
if (typeof data === 'object' && data !== null && 'appointment' in data) { … }
```

Excepción: los `.js` heredados (`flows/`, `sender.js`, `alegra.client.js`)
conviven por `allowJs`. Se migran cuando hay que tocarlos, no antes — una
migración masiva sin necesidad es riesgo sin beneficio.

## 2. Nombres

| Elemento | Convención | Ejemplo |
|---|---|---|
| Archivos | `kebab-case`, con sufijo de rol | `wa-bridge.controller.ts` |
| Directorio de módulo | singular o plural según el dominio | `auth/`, `customers/` |
| Funciones y variables | `camelCase` | `buscarOCrearCliente` |
| Tipos e interfaces | `PascalCase` | `IdentidadWa` |
| Constantes de módulo | `SCREAMING_SNAKE` | `VEHICLE_TYPES` |
| Columnas y tablas | `snake_case` | `scheduled_date` |
| Campos JSON de la API | `snake_case`, igual que la columna | `scheduled_date` |

**El idioma es mixto, a propósito.** El dominio va en español —`buscarCliente`,
`horarios`, `placa`— porque el negocio se piensa en español y traducirlo agrega
una capa de fricción. Lo técnico va en inglés, donde el ecosistema ya lo fijó:
`router`, `middleware`, `query`, `status`.

Los nombres de columna van en inglés porque el esquema empezó así; cambiarlos
ahora costaría más de lo que aclararía.

## 3. Estructura de un módulo

```
src/modules/<nombre>/
├── <nombre>.controller.ts   ← lógica y acceso a datos
└── <nombre>.routes.ts       ← rutas, middleware, validación
```

Sin capa de repositorio: el controlador consulta directo con `db.query()`. Para
el tamaño de este proyecto, una capa más agregaría indirección sin beneficio.

Cuando un módulo crece más allá de eso, se agregan archivos con propósito claro
en vez de inflar el controlador — como `whatsapp/`, que tiene `wa-identity.ts`
para la identificación y `flows/` para las máquinas de estado.

## 4. Consultas

**Siempre parametrizadas.** Nunca interpolación de strings:

```ts
// mal — inyección SQL
db.query(`SELECT * FROM customers WHERE id = '${id}'`);

// bien
db.query('SELECT * FROM customers WHERE id = $1', [id]);
```

**Siempre con `tenant_id`** si la tabla lo tiene:

```ts
db.query(
  'SELECT * FROM appointments WHERE tenant_id = $1 AND id = $2',
  [req.tenantId, id],
);
```

**Tipadas** con el genérico de `db.query`:

```ts
const { rows } = await db.query<{ id: string; status: string }>(…);
```

Las consultas de varias líneas van en template literal, con el SQL indentado
para que se lea como SQL.

## 5. Errores

Los esperables se devuelven con su código; los inesperados suben al
`errorHandler`.

```ts
if (!rows[0]) {
  res.status(404).json({ error: 'Turno no encontrado' });
  return;
}
```

El mensaje es para quien lo va a leer: en español, sin jerga, sin detalles
internos. Lo técnico va al log.

En `catch`, la variable llega como `unknown`:

```ts
} catch (err) {
  console.error('[modulo] Contexto:', (err as Error).message);
}
```

**Las transacciones siempre con `try/catch/finally`:**

```ts
const client = await db.getClient();
try {
  await client.query('BEGIN');
  …
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();   // sin esto, se agota el pool
}
```

## 6. Comentarios

Se comenta **el porqué**, no el qué. El qué ya lo dice el código.

```ts
// mal
// Incrementa el contador
contador++;

// bien
// El bloque anterior ya asignó completedAt para 'delivered'; el guard
// sólo se lo hace explícito a TypeScript.
if (apt.status === 'delivered' && completedAt) {
```

Los casos que merecen comentario:

- Una decisión con alternativa razonable descartada
- Un bug que costó encontrar, para que no vuelva
- Una restricción externa que el código no explica solo
- Una invariante que el compilador no puede ver

Los que no: describir lo evidente, o comentarios que envejecen mal.

## 7. Tests

**Jest + Supertest**, contra PostgreSQL y Redis **reales**. No se mockea la
base: un test contra un mock verifica el mock.

```
__tests__/
├── integration.test.ts      flujos de negocio
├── wa-bridge.test.ts        endpoints del bridge
├── n8n-workflow.test.ts     el workflow, nodo por nodo
├── reminders.test.ts        recordatorios
├── wa-identity.test.ts      identificación por LID
├── compose-env.test.ts      chequeos estáticos de configuración
├── config-env.test.ts       variables vacías
└── helpers/
```

Reglas:

- **Un test que no puede fallar no sirve.** Al escribir uno que verifica
  ausencia de algo, se comprueba que falle rompiendo la cosa a propósito.
- **Nombres que dicen qué se rompe si falla**: `'phone de más de 20 chars → 400,
  no 500 de la BD'`, no `'test log'`.
- **Sin dependencia del reloj.** Un test que pasa a las 9 y falla a las 19 es
  peor que ninguno. Ver `helpers/tenant-clock.ts`.
- **`maxWorkers: 1`**: las suites comparten una base y un Redis; en paralelo se
  pisan.

Antes de un PR:

```bash
npm run db:reset && npx jest && npx tsc --noEmit
```

## 8. Configuración

Toda variable de entorno pasa por `src/config.ts`, validada con Zod. Nunca se
lee `process.env` suelto en un módulo.

El proceso **falla al arrancar** si falta algo obligatorio. Es deliberado:
mejor un contenedor que no levanta que uno que responde 500 a la primera
petición real.

Al agregar una variable:

1. Al esquema de `config.ts`
2. A `.env.example`, con placeholder — **nunca un valor real**
3. Al `docker-compose.yml`, en los servicios que la necesiten
4. Si es obligatoria, `compose-env.test.ts` verifica que se reenvíe

Ese último punto existe porque una variable que `config.ts` exige y el compose
no pasa impide que el contenedor arranque, y el síntoma visible es un error de
DNS en otro servicio.

## 9. Commits

```
<tipo>(<alcance>): <qué cambia, en imperativo>

<por qué, y qué se verificó>
```

Tipos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

El cuerpo importa más que el título. Un buen commit explica **qué se rompía**
y **cómo se verificó**:

```
fix(booking): compute slot availability in the tenant's timezone

getAvailableSlots took the date in the tenant's timezone but compared it
against the server's UTC clock. For a carwash in Bogotá (UTC-5) open
07:00-19:00 that meant: from 14:00 local onwards every slot was filtered
out, so customers were told there was no availability while the place
was open.

46 tests pass; the timezone helper checked against Bogotá, UTC and Tokyo.
```

Los títulos en inglés siguen la convención del ecosistema; el cuerpo puede ir
en cualquiera de los dos.

## 10. Qué no hacer

| Práctica | Por qué |
|---|---|
| `any` para salir del paso | Anula el valor de `strict` |
| Consulta sin `tenant_id` | Filtra datos entre lavaderos |
| Interpolar valores en SQL | Inyección |
| `console.log` que quede en el código | Ruido; usar el logger con contexto |
| Secretos en el repositorio | Quedan en el historial para siempre |
| Datos personales en la URL | Terminan en los logs de acceso |
| Tragar un error con `catch {}` | Un fallo silencioso es peor que uno ruidoso |
| Commit que mezcla refactor y arreglo | Imposible de revisar y de revertir |
