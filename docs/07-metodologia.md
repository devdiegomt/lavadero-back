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

## 4. Antes de mergear

```bash
npm run db:reset          # base limpia
npx jest                  # 96 tests
npx tsc --noEmit          # backend
cd bot-wa && npm run build # bot
```

Los cuatro tienen que pasar. Si alguno falla de forma intermitente, **eso es un
bug**, no ruido: un test que falla 1 de cada 8 corridas enseña a ignorar el
rojo. (Pasó — dos suites compartían base y se pisaban en paralelo. Se resolvió
con `maxWorkers: 1`.)

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

## 7. Entornos

| Entorno | Dónde | Datos |
|---|---|---|
| Local | Docker Compose | `db:reset` o `db:demo` |
| Producción | Railway (backend) · Vercel (frontend) | Reales |

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
