# Documentación — Carwash SaaS

Documentación técnica del sistema. Está escrita para que alguien que llega
al proyecto entienda **por qué** está hecho así, no sólo qué hace.

## Por dónde empezar

Si es tu primer día, en este orden:

1. **[Visión general](00-vision-general.md)** — qué resuelve el producto y con qué piezas. 10 minutos.
2. **[Arquitectura](01-arquitectura.md)** — cómo se reparte el trabajo entre esas piezas y por qué.
3. **[Estándares](06-estandares.md)** y **[Metodología](07-metodologia.md)** — cómo se escribe y se entrega código acá.

Después, según lo que vayas a tocar:

| Vas a trabajar en… | Leé |
|---|---|
| Un endpoint nuevo | [Interfaces](04-interfaces.md) · [Modelo de datos](03-modelo-de-datos.md) |
| El bot de WhatsApp | [Arquitectura §4](01-arquitectura.md#4-el-subsistema-de-whatsapp) |
| Algo que toque datos de clientes | [Seguridad §5](05-seguridad.md#5-datos-personales-ley-1581) |
| Facturación | [Seguridad §6](05-seguridad.md#6-facturación-electrónica-dian) |
| Decidir algo estructural | [ADRs](adr/) — y escribí uno nuevo |

## Índice

| Documento | Contenido |
|---|---|
| [00 · Visión general](00-vision-general.md) | Producto, actores, glosario, alcance |
| [01 · Arquitectura](01-arquitectura.md) | Componentes, monolito vs microservicios, flujos |
| [02 · Requerimientos](02-requerimientos.md) | Funcionales y no funcionales |
| [03 · Modelo de datos](03-modelo-de-datos.md) | 15 tablas, relaciones, multi-tenancy |
| [04 · Interfaces](04-interfaces.md) | API REST, contratos internos, frontend |
| [05 · Seguridad](05-seguridad.md) | Controles, Ley 1581, DIAN, brechas abiertas |
| [06 · Estándares](06-estandares.md) | Convenciones de código y de commits |
| [07 · Metodología](07-metodologia.md) | Flujo de trabajo, definición de hecho |
| [ADRs](adr/) | Decisiones de arquitectura y su porqué |

Para levantar el entorno, desplegar u operar en producción, el
[README de la raíz](../README.md) sigue siendo la referencia.

## Cómo mantener esto

Tres reglas, para que la documentación no se vuelva ficción:

1. **Si cambia una decisión estructural, se escribe un ADR.** No se edita el
   viejo: se escribe uno nuevo que lo reemplaza y se marca el anterior como
   superado. El historial de por qué cambiaron las cosas vale más que la foto
   actual.

2. **Si un documento contradice al código, el código gana** — y el documento
   se corrige en el mismo PR que introdujo la diferencia.

3. **Lo que no se puede verificar, se marca.** Las secciones que describen
   algo pendiente llevan `⚠️ No implementado`. Documentar una intención como
   si fuera un hecho es peor que no documentarla: quien lea confía.

## Estado

Escrita en septiembre de 2026 contra el código de `main`. Las secciones que
describen algo que todavía no existe están marcadas explícitamente; todo lo
demás fue verificado contra el código o contra la base de datos.
