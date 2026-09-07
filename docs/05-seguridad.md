# 05 · Seguridad

Este documento describe **lo que hay**, con la misma honestidad que lo que
falta. Las brechas están en la §7, priorizadas. No hay certificación formal en
curso; el marco de referencia es OWASP Top 10 más las obligaciones legales de
la §5 y la §6.

## 1. Autenticación

### Contraseñas

`bcrypt` con **10 rondas** (`users.controller.ts`). Sólo se guarda el hash, en
`users.password_hash`.

> ⚠️ 10 rondas está por debajo de lo recomendado hoy (12+). Subirlo es barato
> y no rompe nada: bcrypt guarda el costo en el propio hash, así que los
> existentes siguen validando y se re-hashean al próximo cambio de contraseña.
> Ver §7.

**No hay política de contraseñas** — ni longitud mínima, ni complejidad, ni
verificación contra listas de contraseñas filtradas. Un usuario puede poner
`123`.

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

### ⚠️ El login no tiene límite propio

`STRICT_RATE_LIMIT_MAX` está definido en `config.ts` **y nunca se aplica**.
`POST /api/auth/login` sólo cae bajo el límite global de 100/15min, que es
holgado para fuerza bruta contra una cuenta conocida.

Es la brecha más concreta de este documento y la más barata de cerrar (§7).

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

| # | Brecha | Riesgo | Esfuerzo |
|---|---|---|---|
| 1 | **Login sin rate limit propio** — `STRICT_RATE_LIMIT_MAX` definido y nunca aplicado | Fuerza bruta contra cuentas conocidas | Muy bajo |
| 2 | **Sin política de contraseñas** — se acepta `123` | Cuentas triviales de adivinar | Muy bajo |
| 3 | **bcrypt con 10 rondas** | Menor resistencia offline si se filtra la base | Muy bajo |
| 4 | **Cifrado de credenciales no forzado** — `decryptIfNeeded` acepta texto plano y nada cifra al guardar | Credenciales de facturación en claro sin que nadie lo note | Bajo |
| 5 | **Validación Zod ausente** en `billing`, `history`, `reports`, `superadmin`, `tenants`, `whatsapp` | Entrada no validada hacia la base | Medio |
| 6 | **Sin autorización de tratamiento** (Ley 1581) | Incumplimiento legal | Bajo |
| 7 | **Sin política de retención** | Incumplimiento + crecimiento sin techo | Bajo |
| 8 | **Tokens en `localStorage`** (frontend) | Un XSS expone la sesión | Alto (implica cookies httpOnly y CSRF) |
| 9 | **Sin auditoría de acciones** — sólo hay `appointment_status_log` | No se puede reconstruir quién cambió qué | Medio |
| 10 | **Sin RLS en PostgreSQL** | Una consulta mal escrita cruza tenants | Alto |
| 11 | **Sin derecho de supresión** (Ley 1581) | Incumplimiento legal | Medio |

### Notas sobre algunas

**#4 — cifrado no forzado.** La corrección tiene dos partes: cifrar al
escribir (hoy no hay dónde, porque la clave se carga por SQL) y dejar de
aceptar texto plano en la lectura. Lo segundo es de una línea, pero rompe
cualquier credencial que hoy esté en claro — conviene migrarlas primero con
`npm run db:encrypt-billing-keys`.

**#5 — validación.** Los seis módulos sin Zod reciben parámetros que llegan
directo a las consultas. Las consultas están parametrizadas, así que no hay
inyección SQL, pero sí entra basura: fechas inválidas, IDs con formato
incorrecto, campos ausentes que producen 500 en vez de 400.

**#8 — localStorage.** Es la brecha de mayor riesgo teórico y también la más
cara: implica pasar a cookies `httpOnly` + `SameSite`, lo que a su vez obliga a
protección CSRF. No se recomienda atacarla antes que la 1 a la 6.

**#10 — RLS.** Row Level Security de PostgreSQL convertiría el aislamiento en
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
