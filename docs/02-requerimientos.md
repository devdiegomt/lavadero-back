# 02 · Requerimientos

Los requerimientos funcionales están escritos **contra lo que el sistema hace
hoy**, verificado en el código. Los que faltan están en la §3, separados a
propósito: mezclar lo hecho con lo planeado es cómo un documento deja de ser
confiable.

## 1. Funcionales

Nomenclatura: `RF-<módulo>-<n>`.

### Autenticación y usuarios

| ID | Requerimiento | Dónde |
|---|---|---|
| RF-AUT-1 | Un usuario inicia sesión con correo y contraseña y recibe un access token (15 min) y un refresh token (7 días) | `POST /api/auth/login` |
| RF-AUT-2 | El refresh token rota: al usarlo se revoca y se emite uno nuevo | `POST /api/auth/refresh` |
| RF-AUT-3 | Cerrar sesión revoca el refresh; sin cuerpo revoca todas las sesiones | `POST /api/auth/logout` |
| RF-USR-1 | Un `admin` crea, edita, activa y desactiva usuarios de su tenant | `/api/users` |
| RF-USR-2 | Un usuario cambia su propia contraseña verificando la anterior | `PATCH /api/users/:id/password` |

### Turnos

| ID | Requerimiento | Dónde |
|---|---|---|
| RF-TUR-1 | Se crea un turno con cliente, vehículo, servicio, fecha y hora | `POST /api/appointments` |
| RF-TUR-2 | El precio se calcula del servicio según el tipo de vehículo, no se ingresa a mano | `pricing.ts` |
| RF-TUR-3 | El estado avanza `pending → in_progress → done → delivered`; `cancelled` es terminal | `PATCH /:id/status` |
| RF-TUR-4 | Las transiciones inválidas se rechazan (ej. `pending → done`) | idem, cubierto por tests |
| RF-TUR-5 | Cada cambio de estado queda registrado con quién y cuándo | `appointment_status_log` |
| RF-TUR-6 | El tablero muestra los turnos del día agrupados por estado | `GET /api/appointments/today` |
| RF-TUR-7 | Un turno rápido se crea sin cliente previo, sólo con la placa | `POST /api/appointments/quick` |

### Clientes y vehículos

| ID | Requerimiento | Dónde |
|---|---|---|
| RF-CLI-1 | Alta, consulta, edición y baja lógica de clientes | `/api/customers` |
| RF-CLI-2 | Un cliente tiene varios vehículos | `customers → vehicles` |
| RF-CLI-3 | Se busca un vehículo por placa | `GET /api/vehicles/plate/:plate` |
| RF-CLI-4 | Se consulta el historial de un vehículo o de un cliente | `/api/history/*` |
| RF-CLI-5 | Un cliente se identifica por teléfono **o** por LID de WhatsApp; debe tener al menos uno | `chk_customers_identidad` |

### Servicios y precios

| ID | Requerimiento | Dónde |
|---|---|---|
| RF-SRV-1 | Cada servicio tiene precio por tipo de vehículo: sedán, SUV, camioneta, moto, pickup | `services.price_*` |
| RF-SRV-2 | Un servicio tiene duración estimada, usada para calcular disponibilidad | `estimated_minutes` |
| RF-SRV-3 | Un servicio se activa o desactiva sin borrarlo | `PATCH /:id/toggle` |

### Pagos y facturación

| ID | Requerimiento | Dónde |
|---|---|---|
| RF-PAG-1 | Se registra un pago sobre un turno en estado `done` | `POST /api/payments` |
| RF-PAG-2 | Un turno no admite dos pagos | Devuelve 409 |
| RF-PAG-3 | Se emite factura electrónica de un pago vía Alegra | `POST /api/billing/invoice/:paymentId` |
| RF-PAG-4 | Un fallo de facturación se registra y se puede reintentar | `billing_errors`, `POST /retry/:paymentId` |
| RF-PAG-5 | Se emite nota crédito de una factura | `POST /credit-note/:paymentId` |

### WhatsApp

| ID | Requerimiento | Dónde |
|---|---|---|
| RF-WA-1 | El cliente consulta el estado de su vehículo por placa | intent `check_status` |
| RF-WA-2 | El cliente consulta servicios y precios | intent `list_services` |
| RF-WA-3 | El cliente consulta su historial de visitas | intent `customer_history` |
| RF-WA-4 | El cliente agenda un turno en una conversación de cuatro pasos | intent `book_appointment` |
| RF-WA-5 | El cliente puede pedir hablar con una persona | intent `human_help` |
| RF-WA-6 | Escribir `0` cancela el agendamiento en cualquier paso | `flows/booking.js` |
| RF-WA-7 | Cada mensaje entrante y saliente queda auditado | `whatsapp_messages` |
| RF-WA-8 | Se envía un recordatorio 30 minutos antes del turno | cron cada 5 min |
| RF-WA-9 | Si la IA no está disponible, se clasifica por palabras clave | prefijo `kw:` |

### Multi-tenancy

| ID | Requerimiento | Dónde |
|---|---|---|
| RF-MT-1 | Cada tenant ve únicamente sus datos | `WHERE tenant_id = $1` |
| RF-MT-2 | Un tenant pertenece a un plan que define sus límites | `plans`, `planLimits.ts` |
| RF-MT-3 | El super admin administra tenants y planes | `/api/superadmin/*` |
| RF-MT-4 | Un lavadero se registra por sí mismo | `/api/onboarding/*` |

## 2. No funcionales

Escritos como criterios verificables. Donde no hay medición, se dice.

### Rendimiento

| ID | Requerimiento | Estado |
|---|---|---|
| RNF-REN-1 | Una consulta del panel responde en < 500 ms con 10k turnos | ⚠️ No medido |
| RNF-REN-2 | El bot responde en < 5 s (incluye la llamada a Claude) | ⚠️ No medido; observado ~1-2 s |
| RNF-REN-3 | Las consultas frecuentes tienen índice | ✅ 6 índices en `appointments`, 5 en `customers` |

### Disponibilidad

| ID | Requerimiento | Estado |
|---|---|---|
| RNF-DIS-1 | Que Claude falle no deja al bot sin responder | ✅ Fallback por palabras clave |
| RNF-DIS-2 | Que el backend falle no deja al cliente sin respuesta | ✅ Mensaje de disculpa desde bot-wa |
| RNF-DIS-3 | Que Alegra falle no pierde el pago | ✅ Se registra en `billing_errors` y se reintenta |
| RNF-DIS-4 | bot-wa se reconecta solo si WhatsApp cierra la sesión | ✅ Limpia credenciales y pide QR nuevo |
| RNF-DIS-5 | Objetivo de disponibilidad | ⚠️ No definido |

### Seguridad

Ver [05 · Seguridad](05-seguridad.md). En resumen: contraseñas con bcrypt,
tokens de vida corta con rotación, aislamiento por tenant, cifrado disponible
para credenciales de facturación, rate limiting global.

### Mantenibilidad

| ID | Requerimiento | Estado |
|---|---|---|
| RNF-MAN-1 | Todo el backend en TypeScript con `strict` | ✅ |
| RNF-MAN-2 | Los módulos siguen la misma estructura | ✅ 14 módulos, `controller` + `routes` |
| RNF-MAN-3 | Las decisiones estructurales quedan en un ADR | ✅ Ver `adr/` |
| RNF-MAN-4 | Los cambios tienen prueba automatizada | ✅ 85 tests |

### Compatibilidad

| ID | Requerimiento | Estado |
|---|---|---|
| RNF-COM-1 | Node.js 20+ | ✅ |
| RNF-COM-2 | PostgreSQL 14+ | ✅ Probado contra 16 |
| RNF-COM-3 | El panel funciona en navegadores actuales y en móvil | ⚠️ No probado sistemáticamente |

### Legales

| ID | Requerimiento | Estado |
|---|---|---|
| RNF-LEG-1 | Cumplir la Ley 1581 sobre datos personales | ⚠️ Parcial — ver [Seguridad §5](05-seguridad.md#5-datos-personales-ley-1581) |
| RNF-LEG-2 | Facturar según las reglas de la DIAN | ✅ Delegado en Alegra |
| RNF-LEG-3 | Conservar facturas 5 años | ⚠️ Se guarda la referencia, no el documento |

## 3. Fuera de alcance (por ahora)

Listado a propósito, para que quede claro que la ausencia es una decisión y no
un olvido:

| Función | Por qué no está |
|---|---|
| Cancelar un turno desde WhatsApp | El flujo existe para agendar, no para cancelar. Requiere confirmar identidad antes de dejar cancelar |
| Pagos en línea | Hoy se cobra en el local. Habilitarlo trae PCI al alcance |
| Descuentos y promociones | No hay modelo de datos para reglas de precio |
| Inventario de insumos | Otro dominio; el sistema es de turnos, no de stock |
| Notificaciones al personal | El tablero se consulta, no avisa |
| App móvil nativa | El panel es responsive; no se justifica todavía |

Cuando alguna se implemente, se mueve a la §1 con su ID y se borra de acá.
