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
| Validación | Zod, en 8 de 14 módulos | Ver brecha en §7 |

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

**El riesgo, dicho sin vueltas:** una sola consulta que olvide el `tenant_id`
filtra datos entre lavaderos. No hay Row Level Security de PostgreSQL como red
de seguridad — el aislamiento depende de que cada consulta esté bien escrita.

Mitigaciones actuales:

- Todas las consultas de negocio parametrizan `tenant_id` como `$1`, por convención
- Los tests de integración verifican que un tenant desconocido reciba 404

Mitigación que **no** existe: nada impide mecánicamente escribir una consulta
sin el filtro. Ver §7.

**Al escribir una consulta nueva**, la pregunta obligatoria es: *¿puede esta
consulta devolver una fila de otro tenant?* Si toca una tabla con `tenant_id`,
el `WHERE` lo lleva. Siempre.

## 4. Datos en reposo

### Cifrado

Las claves de API de facturación (`tenants.billing_api_key`) **pueden**
guardarse cifradas con **AES-256-GCM**, clave en `ENCRYPTION_KEY` (32 bytes
hex). GCM además autentica: un ciphertext manipulado falla al descifrar en
lugar de devolver basura.

Hay rotación implementada: `npm run db:rotate-key` descifra con la vieja y
re-cifra con la nueva.

> ⚠️ **El cifrado no está garantizado.** La lectura usa `decryptIfNeeded()`,
> que descifra si el valor está cifrado y **devuelve el texto plano si no lo
> está** — una tolerancia que quedó del período de migración. No hay ningún
> punto en el código que cifre al guardar: la clave se cifra a mano con
> `npm run encrypt` y se escribe con un `UPDATE`.
>
> Consecuencia: una credencial guardada en claro funciona perfectamente y
> nada avisa. Verificar el estado real con:
>
> ```sql
> SELECT slug, billing_api_key LIKE '%:%:%' AS parece_cifrada
> FROM tenants WHERE billing_api_key IS NOT NULL;
> ```
>
> Ver brecha #4 en la §7.

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
| Autorización previa del titular | ✅ En WhatsApp — ver abajo |
| Aviso de privacidad accesible | ✅ Parcial — se muestra en la conversación; falta publicarlo completo |
| Finalidad declarada | ✅ En el texto del aviso, versionado |
| Derecho de acceso | ⚠️ Parcial — el cliente ve su historial por WhatsApp, no todos sus datos |
| Derecho de rectificación | ⚠️ Sólo el personal puede corregir |
| Derecho de supresión | ✅ Parcial — `anonimizarCliente()` existe; falta exponerlo al titular |
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

**Pasivo pendiente.** Los clientes creados antes de este paso tienen
`consent_at IS NULL`. `clientesSinAutorizacion(tenantId)` los cuenta. La ley
pide autorización de todos, no sólo de los nuevos: regularizarlos —pidiéndola
en el próximo contacto— es trabajo pendiente del responsable.

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

`anonimizarCliente(tenantId, customerId)` hace lo mismo para un titular
concreto: es el derecho de supresión, que se atiende cuando lo piden y no
cuando vence un plazo. Lleva `tenant_id` en el `WHERE` para que un lavadero no
pueda borrar el cliente de otro. **Falta exponerlo**: hoy es una función, no un
endpoint ni una opción del bot.

> **Ninguna de las dos tareas toca datos de facturación.** `payments` y
> `billing_sync` responden a la obligación de la DIAN de conservar 5 años
> (§6), que es más larga y de otra naturaleza. Un plazo de retención de datos
> personales no la sobreescribe: son obligaciones distintas sobre tablas
> distintas, y confundirlas haría incumplir una para cumplir la otra.

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

> **Cerradas después (2026-09).** *"Sin autorización de tratamiento"* y *"Sin
> política de retención"* se resolvieron en la §5. La supresión quedó a medias
> —la función existe, falta exponerla— y aparece reformulada como la brecha 6;
> los clientes creados antes de la autorización son la 7, que es proceso y no
> código.

| # | Brecha | Riesgo | Esfuerzo |
|---|---|---|---|
| 1 | **Cifrado de credenciales no forzado** — `decryptIfNeeded` acepta texto plano y nada cifra al guardar | Credenciales de facturación en claro sin que nadie lo note | Bajo |
| 2 | **Validación Zod ausente** en `billing`, `history`, `reports`, `superadmin`, `tenants`, `whatsapp` | Entrada no validada hacia la base | Medio |
| 3 | **Tokens en `localStorage`** (frontend) | Un XSS expone la sesión | Alto (implica cookies httpOnly y CSRF) |
| 4 | **Sin auditoría de acciones** — sólo hay `appointment_status_log` | No se puede reconstruir quién cambió qué | Medio |
| 5 | **Sin RLS en PostgreSQL** | Una consulta mal escrita cruza tenants | Alto |
| 6 | **Derecho de supresión no expuesto** (Ley 1581) — `anonimizarCliente()` existe, falta endpoint y opción en el bot | El titular no puede ejercerlo por sí mismo | Bajo |
| 7 | **Clientes sin autorización registrada** — los creados antes de la §5 | Pasivo legal a regularizar | Bajo (proceso, no código) |

### Notas sobre algunas

**#1 — cifrado no forzado.** La corrección tiene dos partes: cifrar al
escribir (hoy no hay dónde, porque la clave se carga por SQL) y dejar de
aceptar texto plano en la lectura. Lo segundo es de una línea, pero rompe
cualquier credencial que hoy esté en claro — conviene migrarlas primero con
`npm run db:encrypt-billing-keys`.

**#2 — validación.** Los seis módulos sin Zod reciben parámetros que llegan
directo a las consultas. Las consultas están parametrizadas, así que no hay
inyección SQL, pero sí entra basura: fechas inválidas, IDs con formato
incorrecto, campos ausentes que producen 500 en vez de 400.

**#3 — localStorage.** Es la brecha de mayor riesgo teórico y también la más
cara: implica pasar a cookies `httpOnly` + `SameSite`, lo que a su vez obliga a
protección CSRF. No se recomienda atacarla antes que las demás.

**#5 — RLS.** Row Level Security de PostgreSQL convertiría el aislamiento en
una garantía del motor en vez de una convención. Es la mitigación correcta a
largo plazo, pero implica revisar las 78 rutas.

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
