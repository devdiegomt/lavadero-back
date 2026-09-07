# ADR-0007 · Los horarios se calculan en la zona del tenant

**Estado:** Vigente
**Fecha:** 2026-08

## Contexto

Calcular qué turnos hay disponibles requiere comparar la hora actual con el
horario de atención del lavadero. El servidor corre en **UTC**; el lavadero
opera en su hora local.

El código original mezclaba ambos: tomaba la fecha en la zona del tenant pero
la comparaba contra el reloj UTC del servidor.

Para un lavadero en Bogotá (UTC-5) abierto de 07:00 a 19:00, eso producía dos
fallas opuestas:

- **Desde las 14:00 locales**, el reloj del servidor ya había pasado la hora de
  cierre, así que se filtraban todos los turnos: el bot decía que no había
  disponibilidad con el local abierto.
- **Después del cierre**, la fecha del tenant seguía siendo hoy mientras UTC ya
  había cambiado de día, así que se ofrecían horarios ya vencidos, incluidas las
  07:00 de esa mañana.

Estuvo presente desde el principio y sólo apareció porque las pruebas cayeron
por casualidad en la franja donde ambas fechas coinciden.

## Decisión

**Toda comparación horaria se hace en la zona del tenant**, tomada de
`tenants.timezone`.

Se agregó `getMinutesOfDayInTimezone()` junto a `getDateInTimezone()`. La
comparación se hace en minutos desde medianoche, en la zona correcta.

## Alternativas descartadas

**Guardar todo en UTC y convertir al mostrar.** Es la práctica habitual y
correcta para timestamps. No aplica acá: `scheduled_time` es una hora de pared
—"las 3 de la tarde en el lavadero"— no un instante. Convertirla a UTC la haría
depender del horario de verano, que Colombia no tiene pero otros países sí.

**Asumir que todos los tenants están en Colombia.** Funcionaría hoy y sería una
bomba de tiempo. La columna `timezone` ya existía.

## Consecuencias

**A favor**

- La disponibilidad es correcta a cualquier hora del día
- El sistema soporta tenants en zonas distintas
- Una comparación de enteros en vez de construir un `Date` por franja

**En contra**

- Toda comparación horaria nueva tiene que acordarse de usar la zona del tenant.
  Nada lo impide mecánicamente.
- Las pruebas de disponibilidad dependían del reloj: se resolvió con un helper
  que fija al tenant en una zona donde la hora local sea media mañana

## Cuándo reconsiderar

Si aparecen turnos que cruzan medianoche o que abarcan varios días, `TIME` deja
de alcanzar y habría que revisar el modelo.

## Lección

El bug sobrevivió porque **las pruebas dependían de la hora a la que se
corrían**. Una prueba que pasa a las 9 y falla a las 19 no está midiendo el
código: está midiendo el reloj.
