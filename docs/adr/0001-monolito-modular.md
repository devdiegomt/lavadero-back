# ADR-0001 · Monolito modular en lugar de microservicios

**Estado:** Vigente
**Fecha:** 2026-08

## Contexto

El sistema cubre catorce áreas funcionales: autenticación, turnos, clientes,
vehículos, servicios, pagos, facturación, reportes, historial, usuarios,
onboarding, super admin, tenants y WhatsApp.

Con esa cantidad de dominios aparece naturalmente la pregunta de si conviene
separarlos en servicios independientes. Las restricciones al momento de
decidir:

- **Un solo desarrollador**
- Sin usuarios en producción todavía
- Todos los módulos comparten el mismo modelo relacional y consultan las mismas
  tablas: un turno necesita cliente, vehículo, servicio y tenant en la misma
  consulta
- Sin ningún módulo con un perfil de carga distinto al resto

## Decisión

**Un monolito modular**: un proceso, una base de datos, un despliegue, con los
módulos organizados en directorios de forma uniforme.

Dos piezas quedan fuera como procesos separados, por razones técnicas
concretas y no por diseño distribuido:

- **`bot-wa`**, porque mantiene un WebSocket permanente con WhatsApp. Ese socket
  es stateful: si el proceso reinicia hay que reconectar, y dos instancias
  simultáneas hacen que WhatsApp cierre una. Dentro del backend, cada despliegue
  del API tumbaría la sesión.
- **`n8n`**, porque su propósito es que el comportamiento conversacional se
  pueda cambiar sin recompilar ni redesplegar.

## Alternativas descartadas

**Microservicios por dominio.** Habría dado despliegue independiente y
escalado por módulo. A cambio: N despliegues, observabilidad distribuida,
consistencia eventual entre servicios que hoy comparten transacción, y latencia
de red donde hoy hay un `JOIN`. Con un desarrollador, el costo operativo supera
cualquier beneficio — y el beneficio principal (equipos trabajando en paralelo
sin pisarse) no aplica cuando hay una sola persona.

**Monolito sin módulos.** Menos ceremonia, pero sin fronteras la lógica se
mezcla y separar algo después se vuelve arqueología.

**Serverless por endpoint.** Mal encaje: las conexiones a PostgreSQL sufren con
arranques en frío y con pools que no se reutilizan, y el bot necesita un proceso
de vida larga que las funciones no ofrecen.

## Consecuencias

**A favor**

- Un despliegue, un log, un lugar donde mirar
- Transacciones ACID entre módulos sin coordinación distribuida
- Refactorizar entre módulos es mover código, no versionar una API
- Un desarrollador nuevo entiende el sistema leyendo un repositorio

**En contra** — y conviene tenerlo presente

- Cambiar `appointments` obliga a redesplegar `billing`
- No se puede escalar un módulo por separado
- Nada impide mecánicamente que un módulo importe de otro y erosione la
  frontera; sólo la disciplina
- Un error no controlado puede tumbar todo el proceso

## Cuándo reconsiderar

Si aparece **alguno** de estos síntomas:

- Un módulo necesita escalar con un perfil muy distinto (por ejemplo, reportes
  consumiendo CPU y afectando la latencia de los turnos)
- Dos o más personas se pisan de forma sistemática en el mismo archivo
- Un despliegue se vuelve riesgoso porque toca todo a la vez
- Un módulo necesita otro lenguaje o motor de datos

Ninguno se cumple hoy. La frontera por directorio deja el camino abierto: el
día que un módulo justifique separarse, ya está delimitado.
