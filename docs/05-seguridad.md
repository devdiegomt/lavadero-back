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
| Rate limit | 100 peticiones / 15 min sobre `/api/` | Global, por IP |
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
| Autorización previa del titular | ⚠️ **No implementado** |
| Aviso de privacidad accesible | ⚠️ **No implementado** |
| Finalidad declarada | ⚠️ No documentada para el titular |
| Derecho de acceso | ⚠️ Parcial — el cliente ve su historial por WhatsApp, no todos sus datos |
| Derecho de rectificación | ⚠️ Sólo el personal puede corregir |
| Derecho de supresión | ⚠️ **No implementado** — `deleted_at` es borrado lógico, el dato sigue ahí |
| Registro de bases ante la SIC | ⚠️ Depende del tamaño del responsable; verificar |
| Medidas de seguridad | ✅ Parcial — control de acceso y cifrado de credenciales |

**El más urgente es la autorización.** Hoy, cuando un cliente escribe al bot por
primera vez, se crea un registro con su nombre y su LID sin haberle pedido
permiso ni haberle dicho para qué. Un primer mensaje que declare la finalidad y
pida conformidad cierra la mayor parte de la brecha, y es barato.

### Retención

No hay política. `whatsapp_messages` crece sin límite, guardando conversaciones
indefinidamente. La Ley 1581 pide conservar los datos sólo mientras la finalidad
lo justifique.

Sugerido: purgar `whatsapp_messages` a los 12 meses, y anonimizar clientes sin
actividad en 24. Ambas son tareas de cron y no existen. Ver §7.

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

Ordenadas por relación entre riesgo y esfuerzo. Las tres primeras son de una
tarde.

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

| # | Brecha | Riesgo | Esfuerzo |
|---|---|---|---|
| 1 | **Cifrado de credenciales no forzado** — `decryptIfNeeded` acepta texto plano y nada cifra al guardar | Credenciales de facturación en claro sin que nadie lo note | Bajo |
| 2 | **Validación Zod ausente** en `billing`, `history`, `reports`, `superadmin`, `tenants`, `whatsapp` | Entrada no validada hacia la base | Medio |
| 3 | **Sin autorización de tratamiento** (Ley 1581) | Incumplimiento legal | Bajo |
| 4 | **Sin política de retención** | Incumplimiento + crecimiento sin techo | Bajo |
| 5 | **Tokens en `localStorage`** (frontend) | Un XSS expone la sesión | Alto (implica cookies httpOnly y CSRF) |
| 6 | **Sin auditoría de acciones** — sólo hay `appointment_status_log` | No se puede reconstruir quién cambió qué | Medio |
| 7 | **Sin RLS en PostgreSQL** | Una consulta mal escrita cruza tenants | Alto |
| 8 | **Sin derecho de supresión** (Ley 1581) | Incumplimiento legal | Medio |

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

**#5 — localStorage.** Es la brecha de mayor riesgo teórico y también la más
cara: implica pasar a cookies `httpOnly` + `SameSite`, lo que a su vez obliga a
protección CSRF. No se recomienda atacarla antes que la 1 a la 6.

**#7 — RLS.** Row Level Security de PostgreSQL convertiría el aislamiento en
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
