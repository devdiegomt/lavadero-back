# ADR-0010 · Cómo se emite la factura electrónica

**Estado:** Pendiente — decisión abierta, contexto reunido
**Fecha:** 2026-09

> Este ADR no decide nada todavía. Existe porque la pregunta va a volver —«¿un
> cliente pide factura electrónica, qué hacemos?»— y reconstruir el contexto
> desde cero cada vez cuesta más que escribirlo una vez. Cuando se decida, se
> cambia el estado y se llena la sección **Decisión**.

## Contexto

Hoy el sistema emite factura electrónica **a través de Alegra**, un proveedor
tecnológico de pago. Está detrás de una interfaz (`modules/billing`), las
credenciales son **por lavadero** y cifradas, y **la facturación es opcional**:
un tenant sin credenciales usa el resto del sistema con normalidad.

Eso deja dos preguntas sin responder, y las dos son de negocio antes que de
código:

1. ¿Hay que pagarle a alguien para facturar?
2. Si hay que pagar, ¿lo paga cada lavadero o lo absorbe el SaaS?

## Lo que dice la DIAN

Fuente: *Abecé Factura Electrónica — Información para el facturador* (DIAN), y
la [Resolución 000165 de 2023](https://www.dian.gov.co/normatividad/Normatividad/Resoluci%C3%B3n%20000165%20de%2001-11-2023.pdf).

### Quién está obligado (Art. 7)

- Personas jurídicas.
- Responsables del **IVA**.
- Responsables del **Impuesto Nacional al Consumo (INC)**.
- Personas naturales con ingresos brutos por encima de **3.500 UVT**, o dentro
  del artículo 437 del Estatuto Tributario.
- Contribuyentes del régimen **SIMPLE**.

### Quién NO está obligado (Art. 8)

- **Personas naturales no responsables de IVA o de INC.**
- Asalariados y pensionados.
- Personas naturales que sólo vendan bienes excluidos o presten servicios no
  gravados con IVA, con ingresos inferiores a 3.500 UVT.
- Bancos, corporaciones financieras y compañías de financiamiento.
- Juntas de Acción Comunal, con condiciones.

**Esto es lo primero que hay que mirar, y cambia la prioridad entera.** Un
lavadero pequeño, persona natural, por debajo del umbral, **no tiene que
facturar electrónicamente**. Si esa es la mayoría de los clientes, la decisión se
puede posponer sin costo — y hoy no bloquea nada, porque la facturación sólo se
activa cuando el tenant carga credenciales.

El valor del UVT cambia todos los años. Antes de concluir que alguien está o no
obligado, mirar el UVT vigente.

### Las tres formas de facturar

El documento oficial es explícito: se puede facturar

1. a través de un **Proveedor Tecnológico**,
2. con **software propio**,
3. con el **servicio gratuito de la DIAN**.

Y **en los tres casos** hace falta un **certificado de firma digital**, que se
solicita a una entidad de certificación, tiene costo anual y es **por NIT**.

## Las opciones, con lo que cada una implica acá

| | Proveedor tecnológico | Software propio | Servicio gratuito DIAN |
|---|---|---|---|
| Costo directo | Mensual, por lavadero | Certificado por NIT + desarrollo | Sólo el certificado |
| Se puede automatizar desde el panel | Sí | Sí | **No** (ver abajo) |
| Habilitación ante la DIAN | La tiene el proveedor | **Hay que pasarla** | No aplica |
| Trabajo de desarrollo | Ya está hecho (Alegra) | Semanas | Ninguno |
| Depende de un tercero | Sí | No | De la DIAN |

### Por qué el servicio gratuito no resuelve el problema del SaaS

Es gratuito y perfectamente válido. Pero **es un portal web**: una persona entra,
escribe la factura y la emite. No expone una API para que un sistema de terceros
facture por cuenta del obligado.

Para un lavadero que factura tres veces al día, alcanza. Para automatizarlo desde
el panel —que es la razón de que exista el módulo de facturación— no sirve: cada
factura habría que volver a teclearla.

> **Sin verificar.** Esto último no sale del documento oficial: es lo que se sabe
> del portal. Antes de descartar la opción, confirmarlo con la DIAN.

### Qué implica «software propio»

Es el camino que daría independencia, y no es corto:

- Generar el **XML en UBL 2.1** con los campos de la Resolución 000165.
- **Firmarlo digitalmente** (XAdES) con el certificado del obligado.
- Calcular el **CUFE** y manejar los **rangos de numeración** autorizados.
- Pasar la **habilitación**: la DIAN exige un set de documentos de prueba y los
  aprueba antes de permitir facturar en producción.
- Implementar las **notas crédito y débito**, que también se transmiten y validan
  electrónicamente.
- Implementar las **contingencias** (ver abajo).

## El problema estructural, que es el que hay que resolver primero

**Cada lavadero factura bajo su propio NIT.** El certificado de firma digital y
la habilitación son del obligado, no del software. Así que hay tres formas de
encajar un SaaS multi-inquilino en el régimen, y no son equivalentes:

- **(a) Integrar un proveedor tecnológico** — lo que se hace hoy. El lavadero
  contrata al proveedor, el SaaS guarda sus credenciales y le habla por API. La
  responsabilidad ante la DIAN queda del lado del proveedor.
- **(b) Que el SaaS sea el «software propio» de cada lavadero** — cada uno con su
  certificado y su habilitación, usando el mismo software. Es la opción que
  eliminaría el costo recurrente, y **es la que hay que consultar**: no está
  claro que la DIAN acepte que un software de terceros cuente como propio del
  obligado, ni cómo se manejarían las habilitaciones en masa.
- **(c) Convertirse en Proveedor Tecnológico** — es una figura que la DIAN
  autoriza aparte, con requisitos propios (capital, garantías, certificación).
  Sólo tiene sentido con muchos lavaderos facturando.

**La pregunta abierta, y va antes que cualquier línea de código:**

> ¿Puede un SaaS multi-inquilino ser el «software propio» de cada uno de sus
> clientes, cada uno con su certificado y su habilitación? ¿O eso obliga a
> registrarse como Proveedor Tecnológico?

## Contingencias: cualquier opción tiene que cubrirlas

El documento describe dos, y las dos son obligaciones, no cortesías:

**Tipo 04 — se cae la DIAN.** Comprobar la caída con 4 intentos separados 20
segundos, guardar la evidencia del error, emitir la factura al cliente sin
validación previa (el negocio es válido), reintentar a los 30 minutos y, **como
máximo a las 48 horas**, transmitir los XML marcados como tipo 04. Firmados con
el certificado.

**Tipo 03 — falla el facturador.** Requiere haber solicitado **antes** la
autorización de numeración de factura de talonario o papel. Se emite en papel
cumpliendo el artículo 617 del ET y, superada la contingencia, se transmite
dentro de las **48 horas** marcando tipo 03.

Hoy el sistema no implementa ninguna de las dos: con un proveedor tecnológico, la
tipo 04 la maneja el proveedor. Con software propio, habría que construirlas.

## Datos del comprador: lo que no se puede pedir

El artículo 11 de la Resolución 000165 fija qué lleva la factura, y el documento
lo subraya: **no se le puede pedir al comprador información adicional a la que
establece la norma** — nombre, NIT y correo electrónico. Tampoco se le puede
exigir el RUT al momento de la compra.

Si el comprador no da su identificación, se registra la frase **«consumidor
final»** con el número **222222222222**.

Esto importa para el panel: un formulario de facturación que exija más datos que
esos, o que bloquee la venta si el cliente no los da, estaría incumpliendo. El
caso «consumidor final» es el normal en un lavadero.

## Lo que ya está resuelto de este lado

- La facturación vive detrás de una interfaz (`modules/billing`), así que cambiar
  de proveedor no es rehacer el módulo.
- Las credenciales son por lavadero y **están cifradas** (ver
  [Seguridad §4](../05-seguridad.md)).
- Un fallo de facturación no pierde el pago: queda en `billing_errors` y se
  reintenta (RNF-DIS-3).
- De cada factura emitida queda **copia propia verificable por hash**, que
  sobrevive a la cuenta del proveedor: [ADR-0009](0009-archivo-de-facturas.md).
  Lo que falta ahí es el **XML firmado**, que es el documento que la DIAN
  considera la factura, y que Alegra no expone por API.

## Criterios para decidir, cuando llegue el momento

1. **¿Cuántos clientes están realmente obligados?** Si son pocos, integrar un
   proveedor y seguir. Es la respuesta correcta hasta que deje de serlo.
2. **¿Cuánto pesa el costo mensual comparado con la habilitación?** Un proveedor
   cuesta todos los meses; construirlo cuesta una vez y después se mantiene.
   Con pocos lavaderos, pagar sale más barato que construir.
3. **¿Qué dice la DIAN sobre la opción (b)?** Si la descarta, la disyuntiva real
   es proveedor o convertirse en proveedor, y la segunda necesita escala.

## Lo que falta verificar

- Si el servicio gratuito de la DIAN tiene alguna forma de integración.
- Si un SaaS puede ser «software propio» de sus clientes.
- Precios vigentes de proveedores tecnológicos con API en Colombia. **Este
  documento no cita ninguno a propósito**: cambian, y un precio desactualizado en
  un documento es peor que ninguno.
- Si Alegra expone el XML firmado por API, que es lo que dejaría RNF-LEG-3
  completo.

## Cuándo reconsiderar

Cuando aparezca el primer cliente obligado a facturar, o cuando el costo mensual
sumado de los proveedores se acerque al costo de construirlo.
