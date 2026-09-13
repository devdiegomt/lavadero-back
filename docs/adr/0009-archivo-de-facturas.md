# ADR-0009 · Las facturas se archivan en PostgreSQL

**Fecha:** 2026-09 · **Estado:** aceptado

## Contexto

La DIAN obliga a conservar las facturas electrónicas **cinco años**. Hasta ahora
el sistema guardaba, en `payments`:

- `invoice_number` — el número
- `invoice_cufe` — el CUFE
- `invoice_pdf_url` — **una URL** al PDF alojado en Alegra

Eso no cumple la obligación. Una URL es un puntero a un documento de otro, y
depende de tres cosas que el lavadero no controla: que la cuenta de Alegra siga
vigente, que el proveedor no cambie su política de retención, y que no pierda el
archivo. Cualquiera de las tres falla y no queda nada que mostrar.

El riesgo no es teórico para este proyecto: las credenciales de facturación son
por lavadero, y un lavadero que deja de pagar Alegra pierde el acceso a sus
propias facturas emitidas — que igual tiene que conservar.

## Decisión

**Se guarda una copia propia de cada factura en PostgreSQL**, en la tabla
`invoice_archive`, con dos artefactos por factura:

| Artefacto | Qué aporta |
|---|---|
| **PDF** | La representación gráfica, tal como la recibió el cliente |
| **JSON de Alegra** | El registro completo: ítems, importes, impuestos, CUFE y estado ante la DIAN |

Cada fila lleva su **SHA-256**. Una copia que no se puede verificar no es una
copia: sin el hash, un byte corrupto en un respaldo de hace tres años se
descubre el día que la DIAN pide el documento.

El archivado corre al emitir y **nunca hace fallar una emisión**. Una factura
emitida con la copia pendiente es un problema mucho menor que una emisión que
falla por no poder guardar la copia. Lo que quede sin archivar se recupera con
`npm run db:archivar-facturas`, que también cubre lo emitido antes de que esto
existiera.

## Alternativas descartadas

**Almacenamiento de objetos (S3 o similar).** Es lo correcto a gran escala y
sería lo primero que habría que hacer si esto creciera. Hoy agrega un proveedor,
credenciales que rotar y un segundo lugar que respaldar — y una obligación de
cinco años quiere **una** cosa que respaldar, no dos que se desincronizan. Se
descarta por ahora, no por siempre: ver "cuándo reconsiderar".

**Un volumen en disco.** Más simple que S3 y peor que la base: hay que
respaldarlo aparte, y un despliegue que pierde el volumen pierde las facturas sin
que el respaldo de la base lo note.

**Seguir confiando en Alegra.** Es lo que había. Funciona hasta que no.

## Consecuencias

**A favor**

- El lavadero tiene sus facturas aunque pierda la cuenta de Alegra
- El respaldo de la base incluye los documentos, sin un segundo procedimiento
- La integridad es verificable, no asumida

**En contra**

- La base crece. Un lavadero que factura 5.000 documentos al año acumula unos
  2,5 GB en el plazo completo, a ~100 KB por PDF. PostgreSQL lo maneja con TOAST
  comprimiendo, pero el respaldo pesa más y tarda más.
- Los `bytea` grandes no son el caso de uso natural de una base relacional. Es un
  compromiso deliberado, no un descuido.

## Lo que esto **no** resuelve

**No se archiva el XML firmado**, que es el documento legalmente autoritativo —
el PDF es su representación gráfica. El cliente de Alegra de este proyecto no
expone un método para pedirlo y no se va a inventar un endpoint a ciegas.

Es la parte que falta para decir que la obligación está cumplida del todo.
Quien tenga acceso a la documentación de Alegra debería verificar si el XML se
puede pedir por API; si se puede, la tabla ya lo contempla (`kind = 'xml'`) y
alcanza con agregar la descarga.

Mientras tanto, lo que hay elimina el punto único de fallo, que era el riesgo
inmediato.

## Cuándo reconsiderar

- **Si el archivo pasa de ~10 GB**, o si el respaldo de la base empieza a tardar
  de más por su culpa. Ahí el almacenamiento de objetos deja de ser prematuro.
- **Si se suman muchos lavaderos.** El cálculo de arriba es para uno.
- **Si aparece el XML por API.** Eso cambia qué se guarda, no dónde.
