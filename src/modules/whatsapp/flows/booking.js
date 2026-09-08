/**
 * Flujo: Agendar Turno por WhatsApp
 * 
 * Steps:
 *   init → awaiting_plate → awaiting_service → awaiting_time → awaiting_confirm → done
 * 
 * Sub-flujo si la placa no existe:
 *   awaiting_plate → awaiting_name → awaiting_consent → awaiting_vehicle_type
 *   → (continúa con awaiting_service)
 */

const db = require('../../../shared/db');
const { getServicePrice, formatCOP } = require('../../../shared/utils/pricing');
const { buscarOCrearCliente } = require('../wa-identity');
const { elegirTipoVehiculo, elegirOpcion } = require('../menu');
const {
  textoAutorizacion,
  interpretarRespuesta,
  autorizacionDe,
  TEXTO_RECHAZO,
  TEXTO_REPREGUNTA,
} = require('../consentimiento');
const {
  getTenantToday,
  getTenantTimezone,
  sumarDias,
  getDateInTimezone,
  getMinutesOfDayInTimezone,
} = require('../../../shared/utils/dateUtils');

/**
 * Genera slots disponibles para un tenant en una fecha dada.
 */
async function getAvailableSlots(tenantId, date, estimatedMinutes) {
  // Obtener configuración del tenant
  const { rows: tenantRows } = await db.query(
    'SELECT opening_time, closing_time, bays_count FROM tenants WHERE id = $1',
    [tenantId]
  );
  if (tenantRows.length === 0) return [];

  const { opening_time, closing_time, bays_count } = tenantRows[0];

  // Obtener turnos ya agendados para la fecha
  const { rows: bookedSlots } = await db.query(
    `SELECT scheduled_time, s.estimated_minutes
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     WHERE a.tenant_id = $1
       AND a.scheduled_date = $2
       AND a.status NOT IN ('cancelled', 'delivered')
       AND a.scheduled_time IS NOT NULL`,
    [tenantId, date]
  );

  // Generar slots cada 30 min entre apertura y cierre
  const openHour = parseInt(opening_time.split(':')[0]);
  const openMin = parseInt(opening_time.split(':')[1] || '0');
  const closeHour = parseInt(closing_time.split(':')[0]);
  const closeMin = parseInt(closing_time.split(':')[1] || '0');

  const slots = [];

  // Comparar contra la hora del lavadero, no la del servidor (que corre en
  // UTC): usar el reloj del servidor descarta turnos que localmente todavia
  // no pasaron, y despues del cierre ofrece turnos ya vencidos.
  const tz = await getTenantTimezone(tenantId);
  const isToday = date === getDateInTimezone(tz);
  const ahoraMin = getMinutesOfDayInTimezone(tz);

  for (let h = openHour; h < closeHour || (h === closeHour && 0 < closeMin); h++) {
    for (let m of [0, 30]) {
      if (h === closeHour && m >= closeMin) break;

      // Si es hoy, saltar slots que ya pasaron (+ 30 min de margen)
      if (isToday && h * 60 + m <= ahoraMin + 30) continue;

      // Contar cuántas bahías están ocupadas en este slot
      const slotStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      const occupiedBays = bookedSlots.filter(bs => {
        if (!bs.scheduled_time) return false;
        const bsH = parseInt(bs.scheduled_time.split(':')[0]);
        const bsM = parseInt(bs.scheduled_time.split(':')[1]);
        const bsStart = bsH * 60 + bsM;
        const bsEnd = bsStart + (bs.estimated_minutes || 60);
        const slotStart = h * 60 + m;
        return slotStart >= bsStart && slotStart < bsEnd;
      }).length;

      if (occupiedBays < bays_count) {
        slots.push(slotStr);
      }
    }
  }

  // Limitar a 6 opciones para no saturar el mensaje
  return slots.slice(0, 6);
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

async function handle(ctx) {
  const { text, session, tenant } = ctx;
  const step = session?.step || 'init';
  const data = session?.data || {};

  // ─── INIT ───
  if (step === 'init') {
    return {
      messages: [
        `📋 *Agendar turno*\n\nEscribe la *placa* de tu vehículo.\n\nEjemplo: ABC123`,
      ],
      nextFlow: 'booking',
      nextStep: 'awaiting_plate',
      data: {},
    };
  }

  // ─── AWAITING PLATE ───
  if (step === 'awaiting_plate') {
    const plate = text.trim().toUpperCase().replace(/[\s-]/g, '');

    if (!/^[A-Z]{3}\d{2,3}[A-Z]?$/.test(plate)) {
      return {
        messages: [`❌ Placa no válida. Escribe sin espacios: *ABC123*\n\n_Escribe 0 para volver al menú._`],
        nextFlow: 'booking',
        nextStep: 'awaiting_plate',
        data,
        retry: true,
      };
    }

    // Buscar vehículo existente
    const { rows: vehicles } = await db.query(
      `SELECT v.*, c.first_name, c.last_name, c.phone, c.id as customer_id
       FROM vehicles v
       JOIN customers c ON c.id = v.customer_id
       WHERE UPPER(v.plate) = $1 AND v.tenant_id = $2 AND v.deleted_at IS NULL
       LIMIT 1`,
      [plate, tenant.id]
    );

    if (vehicles.length > 0) {
      const v = vehicles[0];
      const vehicleInfo = [v.brand, v.model, v.color].filter(Boolean).join(' ');

      // Cargar servicios activos
      const { rows: services } = await db.query(
        'SELECT * FROM services WHERE tenant_id = $1 AND is_active = true ORDER BY sort_order, name',
        [tenant.id]
      );

      const serviceList = services.map((s, i) =>
        `${i + 1}️⃣ ${s.name} — ${formatCOP(getServicePrice(s, v.vehicle_type))}`
      ).join('\n');

      return {
        messages: [
          `🚗 Encontramos tu vehículo:\n*${plate}*${vehicleInfo ? ` — ${vehicleInfo}` : ''}\n\nElige el servicio:\n\n${serviceList}\n\nEscribe el *número* del servicio.`,
        ],
        nextFlow: 'booking',
        nextStep: 'awaiting_service',
        data: {
          plate,
          vehicleId: v.id,
          vehicleType: v.vehicle_type,
          customerId: v.customer_id,
          customerName: v.first_name,
          services: services.map(s => ({ id: s.id, name: s.name, price: getServicePrice(s, v.vehicle_type), minutes: s.estimated_minutes })),
        },
      };
    }

    // Vehículo no encontrado — pedir nombre para registro
    return {
      messages: [
        `🆕 No encontramos la placa *${plate}* en nuestro sistema.\n\nVamos a registrarte. ¿Cuál es tu *nombre completo*?`,
      ],
      nextFlow: 'booking',
      nextStep: 'awaiting_name',
      data: { plate, isNewCustomer: true },
    };
  }

  // ─── AWAITING NAME (nuevo cliente) ───
  if (step === 'awaiting_name') {
    const name = text.trim();
    if (name.length < 2 || name.length > 80) {
      return {
        messages: [`Por favor escribe tu nombre (entre 2 y 80 caracteres).`],
        nextFlow: 'booking',
        nextStep: 'awaiting_name',
        data,
        retry: true,
      };
    }

    const parts = name.split(' ');
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ') || null;

    // Autorizacion antes de guardar nada: la Ley 1581 la exige previa, y el
    // alta del cliente ocurre en el paso siguiente.
    return {
      messages: [
        `👋 Gracias, *${firstName}*.`,
        textoAutorizacion(tenant.name),
      ],
      nextFlow: 'booking',
      nextStep: 'awaiting_consent',
      data: { ...data, firstName, lastName },
    };
  }

  // ─── AWAITING CONSENT (nuevo cliente) ───
  // Sólo un sí explícito autoriza. La ley pide que sea expresa, así que seguir
  // conversando no cuenta como aceptación.
  if (step === 'awaiting_consent') {
    const respuesta = interpretarRespuesta(text);

    if (respuesta === 'rechaza') {
      return {
        messages: [TEXTO_RECHAZO],
        nextFlow: null,
        nextStep: null,
        data: {},
      };
    }

    if (respuesta === 'ambiguo') {
      return {
        messages: [TEXTO_REPREGUNTA],
        nextFlow: 'booking',
        nextStep: 'awaiting_consent',
        data,
        retry: true,
      };
    }

    return {
      messages: [
        `✅ Gracias. Ahora, ¿qué tipo de vehículo es?\n\n1️⃣ Sedán / Auto\n2️⃣ SUV / Camioneta\n3️⃣ Pickup\n4️⃣ Moto`,
      ],
      nextFlow: 'booking',
      nextStep: 'awaiting_vehicle_type',
      // La constancia viaja en la sesión hasta el alta, un paso más adelante.
      data: { ...data, autorizacion: autorizacionDe('whatsapp') },
    };
  }

  // ─── AWAITING VEHICLE TYPE (nuevo cliente) ───
  if (step === 'awaiting_vehicle_type') {
    // Numero o palabra: el cliente escribe lo que ve en el menu. Ver menu.ts.
    const vehicleType = elegirTipoVehiculo(text);

    if (!vehicleType) {
      return {
        messages: [`No reconocí esa opción. Escribe el *número* (1 al 4) o el tipo: *sedán*, *SUV*, *pickup* o *moto*.`],
        nextFlow: 'booking',
        nextStep: 'awaiting_vehicle_type',
        data,
        retry: true,
      };
    }

    // Crear cliente y vehículo
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Identificar por LID o telefono: WhatsApp no entrega el numero, asi
      // que el LID es lo habitual. El helper enlaza el LID a un cliente que
      // ya estuviera cargado con ese telefono en vez de duplicarlo.
      const customerId = await buscarOCrearCliente(
        tenant.id,
        { phone: ctx.phone ?? null, waLid: ctx.waLid ?? null },
        [data.firstName, data.lastName].filter(Boolean).join(' '),
        client.query.bind(client),
        data.autorizacion
      );

      // Crear vehículo
      const { rows: newVeh } = await client.query(
        `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenant.id, customerId, data.plate, vehicleType]
      );

      await client.query('COMMIT');

      // Cargar servicios
      const { rows: services } = await db.query(
        'SELECT * FROM services WHERE tenant_id = $1 AND is_active = true ORDER BY sort_order, name',
        [tenant.id]
      );

      const serviceList = services.map((s, i) =>
        `${i + 1}️⃣ ${s.name} — ${formatCOP(getServicePrice(s, vehicleType))}`
      ).join('\n');

      return {
        messages: [
          `✅ Registrado correctamente.\n\nAhora elige el servicio:\n\n${serviceList}\n\nEscribe el *número* del servicio.`,
        ],
        nextFlow: 'booking',
        nextStep: 'awaiting_service',
        data: {
          ...data,
          vehicleId: newVeh[0].id,
          vehicleType,
          customerId,
          isNewCustomer: false,
          services: services.map(s => ({
            id: s.id,
            name: s.name,
            price: getServicePrice(s, vehicleType),
            minutes: s.estimated_minutes,
          })),
        },
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── AWAITING SERVICE ───
  if (step === 'awaiting_service') {
    // El nombre del servicio esta a la vista en el mensaje anterior: aceptarlo
    // escrito cuesta lo mismo que exigir el numero.
    const servicios = data.services ?? [];
    const idx = elegirOpcion(text, servicios.map((s) => ({ claves: [s.name] })));

    if (idx === null) {
      return {
        messages: [`❌ No reconocí esa opción. Escribe el *número* del servicio (1 al ${servicios.length || 4}) o su nombre.`],
        nextFlow: 'booking',
        nextStep: 'awaiting_service',
        data,
        retry: true,
      };
    }

    const service = data.services[idx];
    const todayDate = await getTenantToday(tenant.id);
    const slots = await getAvailableSlots(tenant.id, todayDate, service.minutes);

    if (slots.length === 0) {
      // Se queda en awaiting_time, no vuelve a awaiting_service: es el unico
      // paso que entiende la M, y quedarse sin cupo hoy es exactamente cuando
      // ofrecer mañana sirve de algo. Antes el cliente solo podia cambiar de
      // servicio o irse.
      return {
        messages: [
          `😔 No quedan horarios para hoy.\n\nEscribe *M* para ver los de mañana, o *0* para volver al menú.`,
        ],
        nextFlow: 'booking',
        nextStep: 'awaiting_time',
        data: { ...data, selectedService: service, availableSlots: [], bookingDate: todayDate },
      };
    }

    const slotList = slots.map((s, i) => `${i + 1}️⃣ ${formatTime(s)}`).join('\n');

    // La opcion M existia desde siempre y no se anunciaba en ningun mensaje:
    // una funcion que nadie podia descubrir. Un cliente pregunto si solo se
    // podia agendar para hoy.
    return {
      messages: [
        `⏰ *Horarios disponibles para hoy:*\n\n${slotList}\n\nEscribe el *número* del horario, o *M* para ver los de mañana.`,
      ],
      nextFlow: 'booking',
      nextStep: 'awaiting_time',
      // La fecha viaja explicita desde aca. Antes se dejaba sin definir y cada
      // paso posterior la recalculaba con el reloj del servidor, que corre en
      // UTC y no coincide con el dia del lavadero.
      data: { ...data, selectedService: service, availableSlots: slots, bookingDate: todayDate },
    };
  }

  // ─── AWAITING TIME ───
  if (step === 'awaiting_time') {
    // Soporte para "M" = mañana
    if (text.trim().toLowerCase() === 'm') {
      // Mañana es el dia siguiente al del lavadero, no al del servidor.
      const tomorrowDate = sumarDias(await getTenantToday(tenant.id), 1);
      const slots = await getAvailableSlots(tenant.id, tomorrowDate, data.selectedService.minutes);

      if (slots.length === 0) {
        return {
          messages: [`😔 Tampoco hay horarios disponibles para mañana.\n\n_Escribe 0 para volver al menú._`],
          nextFlow: null,
          nextStep: null,
          data: {},
        };
      }

      const slotList = slots.map((s, i) => `${i + 1}️⃣ ${formatTime(s)}`).join('\n');
      return {
        messages: [`⏰ *Horarios disponibles para mañana:*\n\n${slotList}\n\nEscribe el *número* del horario.`],
        nextFlow: 'booking',
        nextStep: 'awaiting_time',
        data: { ...data, bookingDate: tomorrowDate, availableSlots: slots },
      };
    }

    const idx = parseInt(text.trim()) - 1;
    const slots = data.availableSlots || [];

    if (slots.length === 0) {
      return {
        messages: [`Escribe *M* para ver los horarios de mañana, o *0* para volver al menú.`],
        nextFlow: 'booking',
        nextStep: 'awaiting_time',
        data,
        retry: true,
      };
    }

    if (isNaN(idx) || idx < 0 || idx >= slots.length) {
      return {
        messages: [`❌ Opción no válida. Escribe un número del 1 al ${slots.length}.`],
        nextFlow: 'booking',
        nextStep: 'awaiting_time',
        data,
        retry: true,
      };
    }

    const selectedTime = slots[idx];
    const todayDate = await getTenantToday(tenant.id);
    const bookingDate = data.bookingDate || todayDate;
    const dateLabel = bookingDate === todayDate ? 'Hoy' : 'Mañana';

    return {
      messages: [
        `✅ *Confirma tu turno:*\n\n📍 ${tenant.name}\n🚗 ${data.plate}\n🧼 ${data.selectedService.name}\n📅 ${dateLabel}, ${formatTime(selectedTime)}\n💰 ${formatCOP(data.selectedService.price)} COP\n\n¿Confirmar? Escribe *SI* o *NO*`,
      ],
      nextFlow: 'booking',
      nextStep: 'awaiting_confirm',
      data: { ...data, selectedTime, bookingDate },
    };
  }

  // ─── AWAITING CONFIRM ───
  if (step === 'awaiting_confirm') {
    const t = text.trim().toLowerCase();

    if (t === 'si' || t === 'sí' || t === 's' || t === 'yes') {
      // Crear el turno en la base de datos
      const { rows } = await db.query(
        `INSERT INTO appointments
          (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, scheduled_time, price, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'whatsapp')
         RETURNING *`,
        [
          tenant.id,
          data.customerId,
          data.vehicleId,
          data.selectedService.id,
          data.bookingDate || (await getTenantToday(tenant.id)),
          data.selectedTime,
          data.selectedService.price,
        ]
      );

      // Log de creación (sin user, fue por WhatsApp)
      await db.query(
        `INSERT INTO appointment_status_log (appointment_id, new_status, notes)
         VALUES ($1, 'pending', 'Creado vía WhatsApp')`,
        [rows[0].id]
      );

      return {
        messages: [
          `🎉 *¡Turno agendado con éxito!*\n\nTu turno para ${formatTime(data.selectedTime)} está confirmado.\n\nTe enviaremos un recordatorio 30 min antes. Cuando tu vehículo esté listo, te notificamos aquí. 📲\n\n_Escribe 0 para volver al menú._`,
        ],
        nextFlow: null,
        nextStep: null,
        data: {},
      };
    }

    if (t === 'no' || t === 'n') {
      return {
        messages: [
          `❌ Turno cancelado. No se realizó ninguna reserva.\n\n_Escribe 0 para volver al menú._`,
        ],
        nextFlow: null,
        nextStep: null,
        data: {},
      };
    }

    return {
      messages: [`Escribe *SI* para confirmar o *NO* para cancelar.`],
      nextFlow: 'booking',
      nextStep: 'awaiting_confirm',
      data,
      retry: true,
    };
  }

  // Fallback
  return {
    messages: [`_Escribe 0 para volver al menú._`],
    nextFlow: null,
    nextStep: null,
    data: {},
  };
}

module.exports = { handle };
