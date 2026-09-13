# 05 · Seguridad

Este documento describe **lo que hay**, con la misma honestidad que lo que
falta. Las brechas están en la §7, priorizadas. No hay certificación formal en
curso; el marco de referencia es OWASP Top 10 más las obligaciones legales de
la §5 y la §6.

## 1. Autenticación

### Contraseñas

`bcrypt` con **12 rondas**, el valor recomendado por OWASP. Sólo se guarda el
hash, en `users.password_hash`.

El costo vive en `shared/utils/password.ts`, no repetido en cada llamada:
estaba escrito a mano en cinco archivos, y subirlo implicaba encontrarlos
todos. Un test verifica que no vuelva a dispersarse.

Subirlo no invalidó nada: bcrypt guarda el costo dentro del hash, así que los
de 10 rondas siguen validando. `necesitaRehash()` permite rehashear al vuelo
cuando alguien inicia sesión con un hash viejo.

**Política de contraseñas:** mínimo 8 caracteres, aplicado en los tres caminos
que fijan una contraseña — alta de usuario, registro self-service y cambio de
contraseña. No hay verificación contra listas de contraseñas filtradas.

### Tokens

Dos tokens, con roles distintos:

| Token | Vida | Dónde vive | Para qué |
|---|---|---|---|
| **Access** | 15 min | Sólo en el cliente | Autoriza cada petición |
| **Refresh** | 7 días | `refresh_tokens`, hasheado con SHA-256 | Obtiene un access nuevo |

El refresh token **rota de verdad**: al usarlo se revoca (`revoked_at = NOW()`)
y se emite uno nuevo. Si alguien roba un refresh y lo usa, el legítimo deja de
funcionar — la anomalía se vuelve visible.

En la base sólo se guarda el **hash** del refresh, no el token. Quien lea la
tabla no puede suplantar a nadie.

`POST /api/auth/logout` revoca; sin cuerpo revoca todas las sesiones del
usuario.

### Autorización

Tres roles: `super_admin`, `admin`, `operator`. El middleware `authorize(...roles)`
los verifica, y `super_admin` pasa siempre.

```ts
router.post('/', authenticate, requireTenant, authorize('admin'), crearServicio);
```

## 2. Superficie expuesta

| Control | Configuración | Nota |
|---|---|---|
| `helmet()` | Por defecto | Cabeceras de seguridad estándar |
| CORS | Origen desde `CORS_ORIGIN`, `credentials: true` | Un solo origen, no comodín |
| Rate limit | 100 peticiones / 15 min sobre `/api/` | Global, por IP — **excepto `/api/wa-bridge`** |
| Rate limit de `wa-bridge` | 120 / 15 min **por cliente de WhatsApp** | Ver abajo |
| Body limit | 1 MB | Contra cargas grandes |
| Validación | Zod en altas, `PATCH` y query; `validarUuid` en todo `:id`; códigos de PostgreSQL traducidos a 400 | Ver brecha #2 en §7 |

### Límite específico del login

`POST /api/auth/login` tiene su propio limitador, además del global:

| Parámetro | Valor | Por qué |
|---|---|---|
| Máximo | `STRICT_RATE_LIMIT_MAX` (5 por defecto) | Mucho más estricto que el global |
| Ventana | `RATE_LIMIT_WINDOW_MS` (15 min) | |
| Clave | `email\|IP` | Un atacante no evade cambiando de cuenta, ni bloquea a un usuario legítimo desde otra IP |
| `skipSuccessfulRequests` | `true` | Un login exitoso no consume cupo |

La clave compuesta es la parte que más importa: limitar sólo por IP permitiría
recorrer cuentas desde una misma dirección, y limitar sólo por email dejaría
bloquear a cualquiera a voluntad.

### Por qué `wa-bridge` no va por IP

Todo el tráfico de `/api/wa-bridge` llega desde n8n, que es **una sola
dirección**. Con el límite global, la cuota de 100 peticiones cada 15 minutos
la compartían *todos* los clientes del lavadero: unos 20 mensajes la agotaban y
el bot dejaba de responderle a cualquiera. Es una denegación de servicio que no
necesita atacante — basta con que el negocio funcione.

Ocurrió en producción, y **el síntoma no delataba la causa**: un 429 en
`booking-step` hace que n8n crea que no hay conversación en curso y mande el
mensaje a Claude, así que se veía como si el agendamiento estuviera roto.

Ahora esas rutas llevan su propio limitador, contado por
`tenant + (LID o teléfono)`. Va **después** de `n8nAuth`: quien llega ahí ya
demostró conocer el secreto compartido, así que lo que queda por contener no es
un atacante anónimo sino un cliente —o un bucle— hablando de más.

## 3. Aislamiento multi-tenant

El aislamiento es **por columna**: cada tabla de negocio tiene `tenant_id` y
toda consulta lo incluye. `req.tenantId` sale del JWT vía `requireTenant`.

Eso era todo lo que había, y el riesgo era evidente: una sola consulta de 212 que
olvide el `tenant_id` filtra datos entre lavaderos. Ahora hay una segunda capa
que no depende de que nadie se acuerde.

### Row Level Security

PostgreSQL aplica las políticas: una consulta sin `WHERE tenant_id` devuelve sólo
las filas del lavadero en curso, y una que pida el registro de otro no devuelve
nada. No es que la aplicación filtre mejor — es que el motor no deja ver el
resto.

**El rol es la mitad que se pasa por alto.** RLS **no se aplica a superusuarios
ni a roles con `BYPASSRLS`**, y la aplicación se conectaba como `postgres`, que
es los dos. Habilitar políticas sin cambiar el rol deja un esquema que *parece*
protegido y en ejecución no hace nada — el mismo engaño de `validateId` puesto en
una sola ruta y de `decryptIfNeeded` aceptando texto plano. Por eso
`db:migrate-rls` crea `carwash_app` (`NOSUPERUSER`, `NOBYPASSRLS`) y el servidor
**avisa al arrancar** si las políticas están inertes.

**Cómo sabe el motor de qué tenant se trata.** De `current_setting('app.tenant_id')`,
que `requireTenant` fija sobre la conexión de la petición. Va ahí y no en un
middleware aparte que cada router deba encadenar: todos usan `requireTenant`, así
que no queda ninguno afuera. La conexión viaja en un `AsyncLocalStorage`
(`shared/db/contexto.ts`), y por eso `db.query()` la usa sin que ninguna de las
212 consultas haya tenido que cambiar. El costo es que cada petición retiene una
conexión del pool mientras dura.

**Falla cerrado.** Sin contexto, `current_setting` devuelve NULL y no se ve
ninguna fila. Una ruta que se olvide de abrirlo devuelve vacío, que se nota
enseguida; al revés, el olvido no se notaría nunca — que es la fuga que se viene
a cerrar.

**Las tres puertas de atrás**, que son deliberadas y conviene nombrar:

| Camino | Por qué |
|---|---|
| Autenticación | El login busca al usuario por email para averiguar de qué lavadero es. No se puede filtrar por tenant para averiguar el tenant |
| Onboarding | Crea el tenant: no puede filtrar por algo que todavía no existe |
| Super admin | Ver todos los lavaderos es para lo que existe. Acá el control es `authorize('super_admin')` |

Las tareas de fondo —recordatorios, retención, migraciones de datos— también
cruzan tenants, y tienen que pedirlo con `conBypassRlsFueraDePeticion` o
`queryAdmin`. Que sea explícito es el punto: hace visible en el código que cruzan
tenants, en vez de funcionar por casualidad.

Es un agujero, sí. La diferencia con no tener RLS es que ahora está en cinco
lugares que se leen en un minuto, en vez de repartido en 212 consultas.

**Sin RLS quedan** `plans`, que es el catálogo global de la plataforma y no es de
nadie, y `refresh_tokens`, que se consulta por el hash del token antes de saber de
qué tenant es la sesión — el mismo problema de orden que la autenticación. Lo que
protege a esa tabla es que sólo guarda hashes.

**Cómo se verifica.** `npm run test:rls` corre la suite entera conectada como
`carwash_app`, con las políticas aplicándose de verdad. `__tests__/rls.test.ts`
además intenta leer, modificar, borrar e insertar en el lavadero vecino y
comprueba que el motor lo impide. Probar esto como `postgres` daría verde sin
medir nada.

**Al escribir una consulta nueva**, la pregunta sigue siendo: *¿puede esta
consulta devolver una fila de otro tenant?* El `WHERE tenant_id` se sigue
poniendo. RLS es la red debajo, no el reemplazo: una consulta sin filtro dentro
del contexto correcto devuelve lo que corresponde, pero también trae de más
—todas las filas de ese lavadero— y eso sigue siendo un bug.

## 4. Datos en reposo

### Cifrado

Las claves de API de facturación (`tenants.billing_api_key`) se guardan cifradas
con **AES-256-GCM**, clave en `ENCRYPTION_KEY` (32 bytes hex). GCM además
autentica: un ciphertext manipulado falla al descifrar en lugar de devolver
basura.

Hay rotación implementada: `npm run db:rotate-key` descifra con la vieja y
re-cifra con la nueva.

**El cifrado es obligatorio, no opcional**, y eso son dos cosas:

- **Al leer**, `descifrarCredencial()` exige que el valor esté cifrado. Si está
  en claro lanza `CredencialIlegible` con el comando que lo arregla. Antes esto
  lo hacía `decryptIfNeeded()`, que devolvía el texto plano tal cual: una
  credencial podía quedarse sin cifrar para siempre y todo funcionaba igual, sin
  que nada avisara. Un cifrado opcional no es una medida de seguridad.
- **Al escribir**, `PUT /api/billing/config/credentials` cifra antes del
  `UPDATE`. Es la pieza que faltaba: cifrar al leer no sirve de nada si no hay
  una puerta que cifre al guardar. Antes la única vía era un `UPDATE` por SQL,
  que es justamente cómo terminaban en claro.

Queda `npm run encrypt` para producir un ciphertext a mano, pero ya no es el
camino normal.

**Orden al desplegar.** `db:encrypt-billing-keys` está dentro de
`db:migrate-all`, así que correr las migraciones antes de dar tráfico —que es lo
que dice la [metodología §7](07-metodologia.md)— resuelve la dependencia. Si se
despliega al revés, las facturas fallan con un error que nombra el comando, y
quedan en `billing_errors` para reintentar.

`GET /api/billing/config` devuelve `credencialCifrada`, para que el estado real
se vea desde el panel. También se puede mirar directo:

```sql
SELECT slug, billing_api_key LIKE '%:%:%' AS parece_cifrada
FROM tenants WHERE billing_api_key IS NOT NULL;
```

> **`ENCRYPTION_KEY` no se puede perder.** Sin ella no hay forma de recuperar
> las credenciales de facturación de los tenants. Va en un gestor de secretos,
> no en el repositorio.

### Sin cifrar

Todo lo demás, incluidos los datos personales de la §5. Es una decisión
consciente —el cifrado a nivel de columna complica las búsquedas— pero implica
que **quien acceda a la base ve los datos de los clientes en claro**. La
protección de esos datos depende del control de acceso a la base, no de la
criptografía.

## 5. Datos personales (Ley 1581)

El sistema trata datos personales de terceros, así que la **Ley 1581 de 2012**
y el **Decreto 1377 de 2013** aplican. Esto no es opcional.

### Qué datos se guardan

| Tabla | Columnas | Titular |
|---|---|---|
| `customers` | `first_name`, `last_name`, `phone`, `email`, `document_type`, `document_number`, `wa_lid` | Cliente del lavadero |
| `vehicles` | `plate` | Cliente (la placa identifica indirectamente) |
| `whatsapp_messages` | `phone`, `wa_lid`, `content` | Cliente — **el contenido de sus mensajes** |
| `users` | `first_name`, `last_name`, `email`, `phone` | Personal del lavadero |
| `tenants` | `email`, `phone`, `address`, `whatsapp_phone` | Dueño del lavadero |

`customers.document_number` es la cédula: dato personal directo. Y
`whatsapp_messages.content` guarda el texto literal de las conversaciones —
sensible, porque el cliente puede escribir cualquier cosa ahí.

### Obligaciones y estado actual

| Obligación | Estado |
|---|---|
| Autorización previa del titular | ✅ En WhatsApp, a clientes nuevos y a los que ya existían |
| Aviso de privacidad accesible | ✅ Parcial — se muestra en la conversación; falta publicarlo completo |
| Finalidad declarada | ✅ En el texto del aviso, versionado |
| Derecho de acceso | ✅ *MIS DATOS* por WhatsApp; también hay endpoint en el panel |
| Derecho de rectificación | ⚠️ Sólo el personal puede corregir |
| Derecho de supresión | ✅ *BORRAR MIS DATOS* + confirmación, y `POST /api/customers/:id/anonimizar` |
| Retención limitada | ✅ Tareas de cron con plazo configurable |
| Registro de bases ante la SIC | ⚠️ Depende del tamaño del responsable; verificar |
| Medidas de seguridad | ✅ Parcial — control de acceso y cifrado de credenciales |

### La autorización

La ley la exige **previa, expresa e informada**. Son tres condiciones distintas
y `src/modules/whatsapp/consentimiento.ts` las trata como tales:

- **Previa** — el paso `awaiting_consent` va después de pedir el nombre y
  **antes** del `INSERT` en `customers`. Ese orden es el requisito: preguntar
  después de guardar no sirve de nada.
- **Expresa** — sólo un sí explícito (`si`, `acepto`, `autorizo`, `ok`…)
  autoriza. Cualquier otra respuesta, incluido seguir conversando normalmente,
  se trata como ambigua y se repregunta. El silencio nunca es un sí.
- **Informada** — el aviso dice qué se guarda, para qué, que no se comparte con
  terceros comerciales, y cómo ejercer los derechos: escribiendo *ASESOR*, que
  es la palabra que el bot enruta de verdad (intent `human_help`, tanto por
  Claude como por el fallback de palabras clave). El canal es humano, no
  automático; la ley pide que exista, no que sea un endpoint.

Poder *demostrarla* es parte de la obligación, no un extra. Por eso el alta
guarda tres columnas y no un booleano:

| Columna | Para qué |
|---|---|
| `consent_at` | Cuándo autorizó |
| `consent_version` | **Qué texto** aceptó (`VERSION_AVISO`) |
| `consent_source` | Por qué canal: `whatsapp` \| `panel` \| `onboarding` |

Si mañana cambia la finalidad, cambia `VERSION_AVISO` y queda registro de a
quién se le informó qué. Un `consent = true` no permitiría reconstruir eso.

Si el titular no autoriza, el flujo termina: no se crea el cliente, no se
agenda. Se le sigue pudiendo responder precios y servicios, que no requieren
guardar nada.

### Los clientes que ya existían

Los creados antes de que existiera este paso quedaron con `consent_at IS NULL`.
Durante un tiempo esto se anotó como «pasivo a regularizar, proceso y no
código», y esa lectura era **incompleta**: la consulta que busca el vehículo ni
siquiera miraba `consent_at`, así que al volver, el flujo los reconocía por la
placa y **agendaba de nuevo sin pedírsela nunca**. No era un pasivo quieto — se
volvía a ejercer en cada visita.

Ahora, cuando un cliente conocido sin autorización da su placa, se le pide una
sola vez antes de dejarle agendar. Si acepta, queda en su ficha; si no, no se
agenda. `registrarAutorizacion()` **no pisa una autorización anterior**: la
fecha y la versión originales son la prueba de qué se le informó y cuándo.

Así el pasivo se vacía solo a medida que la gente vuelve.
`clientesSinAutorizacion(tenantId)` sigue contando los que quedan — los que no
han vuelto—, y para esos sí hace falta una decisión del responsable: contactarlos,
o dejar que la retención los anonimice al vencer el plazo.

### Retención

`src/shared/db/retencion.ts`, dos tareas que corren cada 24 h:

| Tarea | Qué hace | Variable | Defecto |
|---|---|---|---|
| `purgarMensajesViejos` | Borra conversaciones más viejas que el plazo | `DATA_RETENTION_MESSAGES_MONTHS` | 12 meses |
| `anonimizarClientesInactivos` | Anonimiza clientes sin visitas en el plazo | `DATA_RETENTION_CUSTOMERS_MONTHS` | `0` (desactivado) |

**Los plazos son una decisión del responsable del tratamiento, no una constante
técnica.** Por eso salen de configuración y `0` desactiva la tarea. Los valores
por defecto son un punto de partida defendible, no asesoría legal.

La anonimización de clientes viene desactivada a propósito: es irreversible y
afecta la relación comercial del lavadero. Que la active quien decide sobre
esos datos.

**Anonimizar es un `UPDATE`, no un `DELETE`.** Los campos que identifican a una
persona se ponen en `NULL` y se marca `anonymized_at`; la fila y sus turnos
siguen existiendo. Un `DELETE` rompería la integridad referencial y perdería el
historial de negocio, que no es dato personal. Por eso el `CHECK` de identidad
de `customers` admite una tercera opción:

```sql
CHECK (phone IS NOT NULL OR wa_lid IS NOT NULL OR anonymized_at IS NOT NULL)
```

### Cómo ejerce el titular sus derechos

| Escribe por WhatsApp | Qué pasa |
|---|---|
| `MIS DATOS` | Le muestra qué se guarda de él y cómo borrarlo |
| `BORRAR MIS DATOS` | **No borra**: avisa de lo irreversible y pide confirmación |
| `CONFIRMO` | Ahí sí suprime |
| `0` | Desiste, no se toca nada |

Y desde el panel, para quien lo pide por otro canal:
`POST /api/customers/:id/anonimizar`, restringido a `admin`.

**Ojo con `DELETE /api/customers/:id`:** ése hace borrado *lógico* —pone
`deleted_at` y la fila conserva nombre, teléfono y cédula—. Sirve para sacar a
alguien del listado, **no para cumplir la ley**. El que suprime de verdad es
`anonimizar`.

#### Tres decisiones que importan

**Palabras reservadas, no una intención de la IA.** Estas frases se
interceptan antes que cualquier otra cosa y se comparan literalmente. Un
derecho que la ley obliga a atender no puede depender de que un modelo acierte:
si Claude está caído o sin crédito, el titular tiene que poder ejercerlo igual.
Mismo criterio que el `0` que cancela el agendamiento. Ver
[ADR-0006](adr/0006-ia-solo-para-clasificar.md).

**Coincidencia exacta contra la frase completa, no por subcadena.** Quien
escribe «no quiero que borren mis datos» no está pidiendo el borrado.
Confundirlo destruiría datos de alguien que pidió justo lo contrario.

**Confirmación en dos pasos.** Pedirlo no borra. Se avisa de lo que se pierde
—incluido que un turno agendado sigue en pie pero deja de poder avisarse— y se
espera un `CONFIRMO` explícito. Ante cualquier otra respuesta se repregunta:
con algo irreversible de por medio, interpretar no es una opción.

`anonimizarCliente(tenantId, customerId)` lleva el `tenant_id` en el `WHERE`,
así que el borrado alcanza sólo al cliente de ese lavadero. En WhatsApp la
identidad es el LID —o el teléfono— desde el que se escribe: es la cuenta del
titular, y en este canal no hay prueba más fuerte disponible.

> **Ninguna de las dos tareas toca datos de facturación.** `payments` y
> `billing_sync` responden a la obligación de la DIAN de conservar 5 años
> (§6), que es más larga y de otra naturaleza. Un plazo de retención de datos
> personales no la sobreescribe: son obligaciones distintas sobre tablas
> distintas, y confundirlas haría incumplir una para cumplir la otra.

### El rastro de acciones

`action_log` registra quién cambió qué desde el panel. Antes sólo existía
`appointment_status_log`, que cubre los cambios de estado de un turno y nada
más: quién desactivó un usuario, quién cambió un precio o quién tocó las
credenciales de facturación no quedaba en ningún lado.

Lo escribe un middleware global (`shared/middleware/auditoria.ts`), no una
llamada en cada controller. La razón es la misma que ya se pagó dos veces en
este proyecto: `validateId` existía desde el principio y estaba puesto en **una**
de veinte rutas, y el cifrado tenía la función de descifrar y ninguna de cifrar.
**Lo que hay que acordarse de poner, no se pone.** El precio es que registra a
nivel HTTP —método, ruta, campos— en vez de en términos del negocio.

**Guarda nombres de campos, nunca valores.** Es una decisión de esta sección, no
una comodidad:

- Guardar los valores convertiría la bitácora en una **segunda copia de los datos
  personales**, con su propia obligación de retención y su propio riesgo si se
  filtra. Una bitácora de cumplimiento que crea un problema de cumplimiento es un
  mal negocio.
- Y arrastraría secretos de paso: contraseñas, tokens, la credencial de Alegra.
  Redactar caso por caso es una lista que se olvida de uno.

Para las preguntas que se hacen de verdad —quién, qué, cuándo, sobre qué
registro— los nombres alcanzan. Si algún día hace falta el antes/después de algo
puntual, se agrega para ese caso con los valores filtrados a mano.

Tiene su propio plazo de retención, `DATA_RETENTION_AUDIT_MONTHS`, más largo que
el de las conversaciones (24 meses por defecto): el valor de una bitácora está en
poder mirar atrás cuando alguien por fin nota algo raro, y eso rara vez pasa la
misma semana. Que tenga plazo y no sea para siempre es porque **qué hizo cada
empleado es dato personal del empleado**, aunque no lo sea del cliente.

Se lee en `GET /api/audit`, sólo `admin`, con filtros por usuario, por registro,
por fecha y por intentos rechazados. Los rechazados se registran a propósito: un
403 es justamente lo que interesa mirar después.

**Lo que no cubre:** la autenticación. Iniciar sesión no es un cambio, el refresh
ocurre cada 15 minutos por usuario, y esas filas no tendrían `tenant_id` —se
conoce después de autenticar—, así que quedarían invisibles en el único lector que
hay. Auditar autenticación es otro problema, que se mira por IP y cruza tenants.
Hoy lo que existe es el limitador por `email|IP` del login (§2).

## 6. Facturación electrónica (DIAN)

La emisión se delega en **Alegra**, que es el proveedor tecnológico autorizado.
Eso traslada a Alegra la mayor parte de las obligaciones formales —numeración
autorizada, firma digital, transmisión a la DIAN— pero no todas.

**Lo que sigue siendo responsabilidad del sistema:**

| Obligación | Estado |
|---|---|
| Custodia de la credencial de Alegra | ⚠️ Cifrado disponible pero no forzado (§4) |
| Trazabilidad de lo emitido | ✅ `billing_sync` y `billing_errors` |
| Reintento ante fallo | ✅ `POST /api/billing/retry/:paymentId` |
| Conservación de documentos | ⚠️ Se guarda la referencia, no el documento |
| Contingencia si Alegra no responde | ⚠️ Se registra el error; no hay procedimiento definido |

La DIAN exige conservar las facturas por **5 años**. Hoy se guarda el ID de la
factura en Alegra, no el documento. Si la cuenta de Alegra se cerrara, la
trazabilidad se perdería. Vale evaluar si conviene guardar una copia.

## 7. Brechas abiertas

Ordenadas por relación entre riesgo y esfuerzo.

> **Corrección (2026-09).** Las tres primeras entradas de la versión anterior
> de esta tabla estaban mal descritas, y conviene dejar constancia:
>
> - *"Login sin rate limit propio"* era **falso**. El limitador existía desde
>   la migración a TypeScript. El error fue de inferencia: se verificó que
>   `STRICT_RATE_LIMIT_MAX` no se usaba —cierto— y se concluyó que el login
>   estaba desprotegido, sin abrir `auth.routes.ts`.
> - *"Sin política de contraseñas"* era **impreciso**. El mínimo de 8
>   caracteres existía en los esquemas; lo que faltaba era aplicarlo en la ruta
>   de cambio de contraseña, que no llamaba a `validate`.
> - *"bcrypt con 10 rondas"* era correcto.
>
> Las tres quedaron resueltas. La lección quedó anotada en la
> [metodología §2](07-metodologia.md): verificar antes de concluir.

> **Cerradas después (2026-09).** *"Sin autorización de tratamiento"*, *"Sin
> política de retención"* y *"Derecho de supresión no expuesto"* se resolvieron
> en la §5. Queda de esa tanda el pasivo de clientes creados antes de que
> existiera la autorización, que es proceso y no código: hoy es la brecha 6.

> **Cerrada (2026-09).** *"Cifrado de credenciales no forzado"* era la #1 y se
> resolvió en la §4: la lectura exige cifrado y hay un endpoint que cifra al
> guardar. Lo que queda de esa tanda es que el resto de los datos sigue sin
> cifrar, que es decisión consciente y está dicho en la §4, no una brecha.

> **Cerrada (2026-09).** *"Sin RLS en PostgreSQL"* era la #5, y era la de mayor
> esfuerzo. Está en la §3. El paso que la activa —apuntar `DATABASE_URL` al rol
> `carwash_app`— es operativo y va aparte del despliegue: la suite pasa con los
> dos roles, y el servidor avisa al arrancar mientras las políticas estén
> inertes.

> **Cerrada (2026-09).** *"Sin auditoría de acciones"* era la #4. Existe
> `action_log`, que escribe un middleware global —no una llamada por controller,
> que es lo que se olvida— y se lee en `GET /api/audit`. Guarda **nombres de
> campos, nunca valores**: ver la §5. Lo que no cubre es la autenticación, que es
> otro problema y tiene otra forma; queda anotado ahí.

| # | Brecha | Riesgo | Esfuerzo |
|---|---|---|---|
| 2 | **Validación Zod ausente en `whatsapp`** — el resto de los módulos ya valida alta, `PATCH` y query | Entrada no validada hacia la base, pero tras la clave compartida de n8n | Bajo |
| 3 | **Tokens en `localStorage`** (frontend) | Un XSS expone la sesión | Alto (implica cookies httpOnly y CSRF) |
| 6 | **Clientes sin autorización que no han vuelto** — a los que vuelven ya se les pide (§5) | Pasivo decreciente | Bajo (decisión del responsable) |

### Notas sobre algunas

**#2 — validación.** Lo que queda es el módulo `whatsapp`: `wa-bridge` y el
webhook validan a mano, campo por campo. Baja prioridad y no por descuido —
detrás de `n8nAuth`, quien llega ahí ya demostró conocer la clave compartida, así
que no es entrada de un desconocido. Igual conviene: la validación a mano se
olvida de un caso y el síntoma aparece lejos.

> **Corrección (2026-09).** La entrada describía esto como "Zod ausente en seis
> módulos", y al medirlo resultó impreciso en las dos direcciones:
>
> - **Más grave de lo escrito.** Se sondearon las rutas con entrada basura y
>   **29 devolvían 500**, incluidos módulos que la tabla daba por validados
>   —`customers`, `vehicles`, `services`, `payments`, `users`—. Tenían Zod en el
>   `POST` de alta y nada en los `:id` ni en el query.
> - **Y el diagnóstico estaba errado.** `validateId` y `validate(…, 'query')`
>   existían desde siempre, puestos en **una** ruta. No faltaba validación:
>   faltaba conectarla. Eso es peor que ausente, porque leyendo el código parece
>   resuelta.
>
> Las tres clases de 500 —ids que no son UUID, query malformado, cuerpos que no
> calzan con la columna— están cerradas, y hay una prueba que recorre las rutas
> con basura y falla si alguna vuelve a contestar 5xx.
>
> **Segunda medición (2026-09).** Al sondear los cuerpos de `PATCH` aparecieron
> nueve 500 más y, peor, cosas que se guardaban con un 200: un email que no es
> email —en `users` es con lo que se inicia sesión— y un `vehicle_type`
> inventado. Ese último no era cosmético: `getServicePrice` cae a `price_sedan`
> cuando el tipo no está en el mapa, así que **una camioneta mal tipeada se
> cobraba como sedán**, sin error y sin aviso.
>
> Los cinco `PATCH` validan ahora con schema, `vehicle_type` tiene `CHECK` en la
> base —de ese campo depende cuánta plata se cobra, y eso no debería apoyarse en
> que todas las rutas se acuerden de validar— y los códigos de PostgreSQL que
> significan "entrada inválida" se traducen a 400 en el `errorHandler`, que cubre
> también las rutas que se agreguen después.
>
> Lo que queda es el módulo `whatsapp`, que sigue validando a mano. Es la brecha
> #2 de abajo, ya sin los demás módulos.
>
> La lección, otra vez la de la [metodología §2](07-metodologia.md): medir antes
> de describir. La tabla llevaba meses afirmando algo que una sonda de veinte
> minutos contradecía.

**#3 — localStorage.** Es la brecha de mayor riesgo teórico y también la más
cara: implica pasar a cookies `httpOnly` + `SameSite`, lo que a su vez obliga a
protección CSRF. No se recomienda atacarla antes que las demás.



## 8. Gestión de secretos

| Secreto | Para qué | Si se filtra |
|---|---|---|
| `JWT_SECRET` | Firma los access tokens | Se pueden forjar sesiones de cualquier usuario |
| `ENCRYPTION_KEY` | Cifra credenciales de facturación | Quedan expuestas; **si se pierde, son irrecuperables** |
| `ANTHROPIC_API_KEY` | Clasificación de intención | Consumo a cargo de la cuenta |
| `N8N_API_KEY` | n8n → backend | Acceso a datos de clientes vía `wa-bridge` |
| `BOT_WA_SEND_TOKEN` | backend → bot-wa | Envío de mensajes desde el número del negocio |

Reglas:

- Ninguno va al repositorio. `.env` está en `.gitignore`; `.env.example` lleva
  placeholders, nunca valores reales.
- `config.ts` **rechaza el arranque** si `JWT_SECRET` conserva el valor de
  ejemplo. Fallar temprano evita producción con un secreto público.
- Al rotar `ENCRYPTION_KEY` se usa `npm run db:rotate-key`. Cambiarla a mano
  vuelve ilegibles las credenciales existentes.

## 9. Al escribir código

Cinco preguntas antes de abrir un PR que toque datos:

1. ¿La consulta filtra por `tenant_id`?
2. ¿La entrada está validada con Zod?
3. ¿La ruta tiene `authenticate` y el `authorize` correcto?
4. ¿Algún log imprime datos personales o secretos?
5. Si guarda datos personales nuevos, ¿está en la tabla de la §5?

Los logs merecen atención especial: `pino` registra las peticiones, y un
parámetro con cédula o teléfono en la URL queda escrito en disco. Los datos
personales van en el cuerpo, no en la query string.
