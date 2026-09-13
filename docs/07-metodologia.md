# 07 · Metodología

El proyecto lo desarrolla **una persona**. Este documento describe la
disciplina que hace las veces de proceso: no hay sprints, dailies ni
retrospectivas, porque ceremonias sin equipo son teatro.

Lo que sí hay son reglas que evitan errores concretos que ya ocurrieron.

## 1. Ramas

```
main ──────●────────●────────●──────▶
            \      /  \     /
             ●────●    ●───●
          claude/xxx  fix/yyy
```

- **`main`** siempre desplegable. No se commitea directo.
- **Rama por unidad de trabajo**, desde `main` actualizado.
- Se integra por **Pull Request**, aunque el revisor sea uno mismo.

El PR no es burocracia con un solo desarrollador: es el lugar donde queda
escrito **qué se cambió y por qué**, en un formato que se puede leer meses
después. El historial de git dice qué líneas cambiaron; el PR dice qué problema
resolvían.

Nombres: `feat/<tema>`, `fix/<tema>`, `docs/<tema>`.

## 2. El ciclo

```
1. Entender el problema      ← reproducirlo antes de tocar código
2. Rama desde main
3. Escribir el cambio
4. Escribir la prueba        ← que falle sin el arreglo
5. Correr todo               ← db:reset + jest + tsc
6. Commit con el porqué
7. PR con contexto
8. Merge y borrar la rama
```

### El paso 1 es el que más se saltea

Buena parte del tiempo perdido en este proyecto se fue en cambiar código a
ciegas ante síntomas mal entendidos. Los casos concretos:

- Se sospechó del formato de la petición a Claude durante dos rondas. El error
  real era **saldo insuficiente**, y el mensaje de la API lo decía textualmente
  desde el principio.
- Tres ramas del bot devolvían vacío. Se probaron dos hipótesis equivocadas
  antes de mirar la ejecución en n8n, que señalaba el nodo exacto.
- El backend no arrancaba por variables faltantes. El síntoma visible era un
  error de DNS en n8n.
- La auditoría de seguridad reportó dos brechas que no existían. Se verificó
  que una variable de configuración no se usaba —cierto— y se concluyó que la
  protección faltaba, sin abrir el archivo de rutas donde sí estaba
  implementada. **Comprobar una parte no autoriza a inferir el resto.**
- Se probó si WhatsApp renderiza selectores nativos enviados por Baileys. Los
  tres formatos devolvieron `ok: true` — el servidor los aceptó — y ninguno se
  vio: llegaron como *«Esperando mensaje»*. **Que una operación no falle no
  prueba que haya hecho lo que se esperaba.** El acuse de recibo de un sistema
  ajeno mide lo que ese sistema aceptó, no lo que el usuario final obtiene.

- El bot dejó de agendar y se culpó al consentimiento, luego a Redis, luego a
  la serialización de fechas. Las tres eran razonables y las tres falsas: era
  un **429** del rate limit, visible en la primera línea de
  `docker compose logs backend --tail`. Se llegó tarde por filtrar el log por
  `"Redis"` y por `"wa-bridge"` — es decir, **buscando la confirmación de cada
  hipótesis en vez de mirar lo que había.** Filtrar un log asume una respuesta.

- La auditoría de WhatsApp llevaba semanas sin registrar nada para los
  clientes identificados sólo por LID —que son el caso normal— y **había
  pruebas que la cubrían**. Pasaban porque el helper que arma el mensaje
  siempre mandaba teléfono: cubrían el único caso que funcionaba. Se descubrió
  contando filas en la base: 0 de 21 tenían `wa_lid`. **Una prueba en verde
  sólo dice que el caso que probaste funciona** — la pregunta útil es cuál es
  el caso que ocurre de verdad en producción.

- Una brecha se clasificó como «proceso, no código» sin abrir la consulta que
  la tocaba. Al abrirla, resultó que el flujo **volvía a incurrir en ella en
  cada visita** del cliente. **Clasificar un problema también es una
  afirmación** y merece la misma comprobación que un diagnóstico.

- Un cambio hizo fallar ocho pruebas ajenas. Cuatro eran fixtures desfasadas,
  pero las otras cuatro destapaban un **bug real de producción** que llevaba
  ahí desde antes: los recordatorios comparaban la fecha contra el reloj del
  servidor. Sólo se vio porque el archivo nuevo cambió el orden de las suites
  y una dejó al tenant en otra zona. **Cuando un cambio rompe pruebas ajenas,
  la primera pregunta es qué están señalando** — no cómo hacerlas pasar.

- Se añadió elegir el día por nombre y la prueba pasaba escribiendo la
  etiqueta completa («Lunes 14»). En producción el cliente escribió «lunes» y
  no funcionó: la comparación busca la clave *dentro* del texto, y ahí el
  cliente escribe **menos** que la etiqueta. **Escribir la prueba con el valor
  que devuelve el código, en vez de con el que teclea una persona, la vuelve
  una tautología.**

- Se fue a cerrar *"validación a mano en el módulo `whatsapp`"* y, al sondearla,
  la validación resultó **buena**: mensajes más útiles que un schema genérico.
  Lo que apareció midiendo fue otra cosa y peor — las seis rutas no tenían
  `asyncHandler`, así que un fallo de base **terminaba el proceso**. **La brecha
  que se va a cerrar también es una afirmación**: conviene comprobarla antes de
  gastar el día en lo que dice, y mirar qué más aparece mientras se mide.

- Una prueba nueva concluyó que el endpoint de auditoría estaba roto. Estaba mal
  la prueba: mandaba el lote como un array suelto y el contrato es
  `{ mensajes: [...] }`. **Antes de reportar un bug a partir de una prueba
  propia, verificar que la prueba habla el mismo idioma que el código.**

- Se midió el panel y la herramienta reportó *"los 12 endpoints por debajo de
  500 ms"*. Cuatro habían devuelto **429**: el limitador los rechazaba en 1,5 ms
  y eso se contaba como rapidez. **Una respuesta que no es 200 no es una
  medición**, y una herramienta que no lo comprueba se aprueba a sí misma.

- La misma medición dio 106 ms para el tablero del día, y el dato era falso por
  el otro lado: el generador de carga concentraba tanto en lo reciente que dejaba
  **3.776 turnos en un solo día**, un tablero que ningún lavadero tiene. **Unos
  datos de prueba poco realistas miden un sistema que no existe** — y da igual si
  el número sale alto o bajo.

- Midiendo el bot, la consulta de "¿ya está mi carro?" saltó de 5 a **60 ms** con
  volumen. Se miró el plan, se culpó al `UPPER(plate)` que impedía usar el
  índice, se creó el índice funcional… y no cambió nada. La causa era otra: el
  generador repartía los estados al azar sobre dos años y dejaba **6.572 turnos
  «pendientes» de hace más de un mes**, que ningún lavadero tiene. Con estados
  realistas son 17 ms. **Se estuvo a punto de optimizar una consulta que no tenía
  nada malo**, y la segunda vez que el mismo generador produce un número
  engañoso.

- La API de producción se reiniciaba sola cada pocos minutos. El correo del
  proveedor decía *"server failure… in many cases this issue resolves
  automatically"*, que invita a esperar. El log tenía dos cosas distintas: un
  `ENOTFOUND` de la base —causa externa, la instancia gratuita había expirado— y
  **un volcado que terminaba en `Node.js v20.20.2`**, que no es un error sino el
  proceso muriéndose, por un cron sin `catch`. Sin lo segundo, la caída de la
  base habría sido un servicio degradado en vez de una API caída. **Cuando algo
  externo falla, la pregunta que queda es por qué nos tumbó** — y esa parte sí es
  nuestra.

- Se dio por terminado el trabajo de RLS con `npm run test:rls` en verde: la
  suite entera contra el rol al que sí se le aplican las políticas. Pero **esa
  suite entra siempre por HTTP**, donde el contexto lo abre `requireTenant`. Lo
  que corre fuera de una petición —seeds y crons— no lo cubría nada, y activar
  RLS habría roto los seeds con un error y dejado la limpieza de `billing_errors`
  **borrando cero filas sin decir nada**. Apareció cuando alguien intentó usarlo
  de verdad. **Una suite en verde delimita lo que ejercita**, y la pregunta útil
  no es cuántas pruebas pasan sino por dónde no entra ninguna.

- El módulo `superadmin` —ocho rutas, la única cuenta que ve todos los lavaderos,
  y uno de los tres bypasses deliberados de RLS— **no tenía ni una prueba**. No
  se descubrió leyendo el código ni mirando un informe de cobertura, sino
  **contando**: `grep -l "/api/superadmin" __tests__/` devolvió cero. Con 376
  pruebas en verde, el número invitaba a suponer que estaba cubierto. Al
  sondearlo apareció además que desactivar un lavadero no cortaba a quien ya
  estaba adentro. **Un total alto de pruebas dice cuánto se ejercita, no qué
  queda afuera**, y lo segundo es lo que hay que preguntar.

**La regla que sale de ahí:** antes de cambiar código, conseguir el dato que
distingue entre las causas posibles. Un log, una ejecución, una petición
reproducida. Si no se puede reproducir, el primer trabajo es hacerlo
reproducible.

## 3. Definición de "hecho"

Una tarea está terminada cuando **todas** se cumplen:

- [ ] El código hace lo que se pidió
- [ ] Hay prueba automatizada, y **falla sin el arreglo**
- [ ] `npx jest` pasa entero
- [ ] `npx tsc --noEmit` limpio en backend y bot-wa
- [ ] Los commits explican el porqué
- [ ] La documentación afectada quedó actualizada **en el mismo PR**
- [ ] Si fue una decisión estructural, hay ADR

El penúltimo punto es el que más se olvida. Documentación que se actualiza
"después" no se actualiza.

### Si el cambio se ve en el navegador, probarlo en un navegador

`supertest` no es un navegador. Copia cabeceras: no aplica `HttpOnly`, ni
`SameSite`, ni `Path`, no decide si una petición cross-origin lleva una cookie,
no corre el JavaScript del panel y manda las peticiones de a una.

La sesión en cookie se dio por terminada con once pruebas verdes de `supertest`
y se mergeó. Después, la primera corrida de Playwright encontró dos fallas —una
cosmética y una que cerraba la sesión sola— que ninguna prueba de este
repositorio podía ver, porque las dos sólo existen del lado del navegador. La
segunda es la más instructiva: el backend **rota** el refresh token en cada uso,
y el panel disparaba varias renovaciones en paralelo. Cada petición, por
separado, era correcta. Lo que fallaba era el conjunto — y eso se rompe recién
cuando algo hace varias a la vez.

Así que: un cambio que toca cookies, sesión, CORS o layout no está probado
mientras no lo haya abierto un navegador. Las pruebas están en
[`e2e/` del frontend](https://github.com/devdiegomt/lavadero-front/tree/main/e2e).

## 4. Antes de mergear

```bash
npm run db:reset          # base limpia
npx jest                  # 383 tests
npm run test:rls          # los mismos, con RLS aplicándose
npx tsc --noEmit          # backend
cd bot-wa && npm run build # bot
```

Y si el cambio se ve en el panel, además, con el backend arriba:

```bash
cd ../lavadero-front && npm run e2e   # 40 pruebas en Chromium, escritorio y móvil
```

Todos tienen que pasar. Si alguno falla de forma intermitente, **eso es un
bug**, no ruido: un test que falla 1 de cada 8 corridas enseña a ignorar el
rojo. (Pasó — dos suites compartían base y se pisaban en paralelo. Se resolvió
con `maxWorkers: 1`.)

**Correrlo dos veces seguidas sin resetear la base.** El estado que una suite
deja es el que la siguiente encuentra, y eso ya rompió cosas cuatro veces: una
zona horaria ajena, un cliente del seed renombrado, la contraseña de un operador
cambiada, y dos suites que le cambiaban el `whatsapp_phone` al tenant sin
devolverlo —lo que hacía que cualquier suite posterior recibiera 404 en todo, sin
ninguna relación aparente con lo que estuviera probando—. Una suite que sólo pasa
sobre una base recién creada está escondiendo una fuga.

## 5. Decisiones de arquitectura

Cuando una decisión cumple alguno de estos criterios, se escribe un ADR:

- Es difícil de revertir
- Descarta una alternativa razonable
- Alguien va a preguntar "¿por qué está hecho así?"

Formato en [`adr/`](adr/). Uno por decisión, numerado, con: contexto,
decisión, consecuencias y alternativas descartadas.

**Un ADR no se edita cuando la decisión cambia.** Se escribe uno nuevo que lo
reemplaza y el viejo se marca como superado. El valor está en el rastro de por
qué se cambió de opinión.

## 6. Trabajo pendiente

No hay tablero. El pendiente vive en dos lugares, ambos dentro del repositorio:

1. **[Seguridad §7](05-seguridad.md#7-brechas-abiertas)** — brechas priorizadas
   por riesgo y esfuerzo
2. **[Requerimientos §3](02-requerimientos.md#3-fuera-de-alcance-por-ahora)** —
   funcionalidad fuera de alcance

Que vivan en el repositorio y no en una herramienta aparte tiene una ventaja: se
actualizan en el mismo PR que los resuelve, así que no envejecen.

## 6.1. Medir antes de optimizar

```bash
npm run db:seed-carga 100000   # volumen realista
npm run medir                  # los 12 endpoints del panel, por HTTP
npm run medir:rls              # los mismos, con RLS aplicándose
npm run medir:bot              # lo que n8n le pide al backend en cada mensaje
npm run medir:bot:rls          # lo mismo, con RLS
```

**Antes de creerle a un número lento, mirar si los datos de prueba se parecen a
la realidad.** Este generador ya produjo dos números engañosos: una distribución
de fechas que ponía 3.776 turnos en un solo día, y estados al azar que dejaban
6.572 turnos «pendientes» de hace un año. Las dos veces el código estaba bien.

Reporta **mediana y p95**, no promedio: un promedio esconde que una de cada
veinte peticiones tarde el triple, y esa es la que el usuario recuerda. Un
endpoint que no devuelve 200 **invalida la corrida** en vez de contarse como
rápido.

Los resultados vigentes están en
[Requerimientos §2](02-requerimientos.md#rendimiento). La regla es la misma que
para todo lo demás: **un requisito con un número y sin medición es una
intención**, y hasta que se mide no se sabe si sobra margen o falta.

## 7. Entornos

| Entorno | Dónde | Datos |
|---|---|---|
| Local | Docker Compose | `db:reset` o `db:demo` |
| Producción | Render (backend + PostgreSQL) · Vercel (frontend) | Reales |

**No hay staging.** Con un desarrollador y sin usuarios en producción todavía,
mantener un tercer entorno cuesta más de lo que evita. Cuando haya usuarios
reales, esto tiene que cambiar: desplegar sin un lugar donde probar la
migración es apostar.

### Antes de desplegar

```bash
docker compose up -d --build
docker compose ps          # los 5 servicios arriba
docker compose logs backend --tail 20
```

Y si hay migración, correrla **antes** de que la versión nueva reciba tráfico:

```bash
docker compose exec backend npm run db:migrate-all:prod
```

**RLS tiene un paso que no es una migración.** `db:migrate-rls` crea el rol
`carwash_app` y las políticas, pero **no cambia con qué rol se conecta la
aplicación**. Mientras `DATABASE_URL` apunte a un superusuario, las políticas
están y no hacen nada — PostgreSQL no las aplica a superusuarios ni a roles con
`BYPASSRLS`. El backend lo dice al arrancar, con un `error` en el log. El cambio
es aparte del despliegue a propósito: la aplicación funciona igual con los dos
roles, así que se puede hacer cuando haya tiempo de mirarlo.

`db:migrate-telefonos` reescribe datos, no esquema, así que además **imprime un
informe**: los clientes que quedaron compartiendo teléfono. Conviene leerlo en
vez de dejarlo pasar — casi siempre es la misma persona cargada dos veces, y el
script no los fusiona a propósito.

## 8. Cuando algo falla en producción

Un orden que evita perder tiempo:

1. **¿Qué código está corriendo?** — `curl localhost:3001/health` devuelve
   `build` y `startedAt`. Un `docker compose up --build` puede reusar una capa
   cacheada sin avisar, y depurar código que no es el que corre es la forma más
   cara de perder una tarde. Pasó tres veces.
2. **¿Qué dice el error?** — el log del servicio que falló, no el del que
   muestra el síntoma. El error suele señalar al vecino.
3. **¿Se puede reproducir?** — con `curl` contra el endpoint. Si se reproduce,
   ya está medio resuelto.
4. **Recién ahí, cambiar código.**

### Dónde mirar

| Síntoma | Primero |
|---|---|
| El bot no responde | `docker compose logs bot-wa` |
| Responde "No entendí" a todo | La ejecución en n8n → nodo de Claude |
| Una rama devuelve vacío | n8n → Executions → el nodo en rojo |
| "Tenant no encontrado" | `TENANT_PHONE` vs `tenants.whatsapp_phone` |
| El backend no arranca | `docker compose logs backend` — nombra la variable |
| Dejó de responderle a un número | `docker compose logs bot-wa \| grep -i bucle` — si repitió el mismo texto tres veces está en silencio; con escribir otra cosa se reanuda |
| Una factura archivada no se puede descargar | `npm run db:verificar-facturas`: si su hash no coincide, el sistema se niega a entregarla como auténtica. Volver a bajarla con `db:archivar-facturas` mientras Alegra siga vigente |
| Un cliente aparece dos veces | `npm run db:migrate-telefonos` lista los que comparten teléfono. No los fusiona: eso se decide a mano |
| El bot deja de responder de golpe | Si el backend murió, mirar si fue un `unhandled rejection`. Toda ruta `async` va con `asyncHandler`: sin él, en Express 4 el rechazo no llega al errorHandler y Node 22 termina el proceso |
| La API se reinicia sola cada pocos minutos | Buscar en el log un volcado que termine en `Node.js v20.x` — eso no es un error manejado, es el proceso muriéndose. Si el stack pasa por una tarea de fondo, va con `correrTarea` (`shared/db/cron.ts`): una promesa que nadie espera necesita un `catch` |
| `getaddrinfo ENOTFOUND dpg-…` / `ECONNREFUSED` al puerto de la base | La base no existe o cambió de dirección, no es un problema de la aplicación. En Render la instancia gratuita de PostgreSQL **expira y se borra**; el hostname deja de resolver y `DATABASE_URL` apunta a la nada. `/api/health` sigue en 200 porque no toca la base: eso ya separa "la app está viva" de "la base no" |
| Una consulta devuelve vacío y debería traer filas | Puede ser RLS: la ruta no abrió el contexto de tenant. Se ve en el log de arranque si RLS está activo, y con `SELECT current_setting('app.tenant_id', true)` en la conexión |

## 9. Cuando el proyecto crezca

Lo que habría que agregar si se suma gente, anotado para no reinventarlo:

| Cuándo | Qué |
|---|---|
| Segunda persona | Revisión de PR por otro; CI que corra los tests |
| Usuarios reales | Entorno de staging; plan de rollback |
| Más de dos personas | Tablero de trabajo; ownership por módulo |
| Varios entornos | Framework de migraciones con versionado ([ADR-0008](adr/0008-migraciones-sin-framework.md)) |

Nada de esto hace falta hoy. Agregarlo antes de tiempo es costo sin beneficio —
pero saber cuál es el disparador de cada cosa evita darse cuenta tarde.
