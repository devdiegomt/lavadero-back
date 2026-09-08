/**
 * La fecha del turno sale del día del lavadero, no del reloj del servidor.
 *
 * `dateUtils.ts` abre diciendo por qué existe: «`new Date().toISOString()`
 * devuelve UTC; en Colombia después de las 7pm la fecha sería incorrecta».
 * El paso de confirmación del agendamiento hacía exactamente eso — calculaba
 * los horarios con `getTenantToday`, correcto, y luego recalculaba la fecha
 * con `new Date()` al confirmar y al guardar.
 *
 * Entre la medianoche UTC y la local, las dos fechas no coinciden y el turno
 * quedaba un día corrido. Por eso estas pruebas ponen al lavadero a propósito
 * en una zona que cae en esa franja: con la del seed pasarían por casualidad.
 */
import * as db from '../src/shared/db';
import { sumarDias, getTenantToday, olvidarTimezone } from '../src/shared/utils/dateUtils';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const booking = require('../src/modules/whatsapp/flows/booking');

let tenant: { id: string; name: string };
let tzOriginal: string;
let servicio: { id: string; name: string; price: number; minutes: number };

/**
 * Pone al lavadero en una zona cuyo día NO es el de UTC en este momento.
 *
 * El desfase se calcula desde la hora UTC actual para que la prueba valga a
 * cualquier hora del día: fijar una zona concreta la haría pasar o fallar
 * según cuándo se ejecute, que es justo el defecto que persigue.
 *
 * **`Etc/GMT` sólo existe de -14 a +12**, y salirse del rango no da un error
 * visible: `Intl` lanza, `getDateInTimezone` cae a su fallback de Colombia y
 * el lavadero termina en el mismo día que UTC — con lo que la prueba pasaría
 * sin comprobar nada. Por eso se apunta a una hora local concreta al otro lado
 * de la medianoche, que siempre cae dentro del rango, en vez de a un desfase
 * arbitrario.
 */
async function ponerLavaderoEnOtroDia(): Promise<string> {
  const utcHour = new Date().getUTCHours();
  // Antes del mediodía UTC: las 23:00 del día anterior (desfase -1 a -12).
  // Desde el mediodía: la 01:00 del día siguiente (desfase +13 a +2).
  const offset = utcHour < 12 ? -1 - utcHour : 25 - utcHour;
  // Etc/GMT tiene el signo invertido: Etc/GMT-3 es UTC+3.
  const tz = offset >= 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;

  await db.query(`UPDATE tenants SET timezone = $1 WHERE id = $2`, [tz, tenant.id]);
  olvidarTimezone(tenant.id); // la cache dura 10 min; sin esto no se vería

  const hoyLavadero = await getTenantToday(tenant.id);
  if (hoyLavadero === new Date().toISOString().split('T')[0]) {
    // Falla acá y no en la aserción de después: así el mensaje dice que el
    // montaje de la prueba no sirvió, en vez de acusar al código.
    throw new Error(
      `El montaje falló: con ${tz} el lavadero sigue en el día de UTC ` +
        `(${hoyLavadero}). La prueba no estaría comprobando nada.`,
    );
  }
  return hoyLavadero;
}

/**
 * Pone al lavadero en una zona donde su hora local es aproximadamente `hora`.
 *
 * Sirve para elegir la rama: a las 09:00 quedan cupos (abre 07:00), cerca del
 * cierre no queda ninguno. Sin esto, cuál de las dos ramas se ejecuta depende
 * de a qué hora se corran las pruebas.
 */
async function ponerLavaderoALasHoras(hora: number): Promise<void> {
  const utcHour = new Date().getUTCHours();
  let offset = hora - utcHour;
  if (offset > 14) offset -= 24;
  if (offset < -11) offset += 24;
  const tz = offset >= 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;

  await db.query(
    `UPDATE tenants SET timezone = $1, opening_time = '07:00', closing_time = '19:00'
     WHERE id = $2`,
    [tz, tenant.id],
  );
  olvidarTimezone(tenant.id);
}

/** Sesión a mitad del paso de horarios, con un cupo ya ofrecido. */
function sesionEnHorarios(bookingDate?: string) {
  return {
    tenant,
    waLid: '99900033300000@lid',
    text: '1',
    session: {
      step: 'awaiting_time',
      data: {
        plate: 'FEC001',
        selectedService: servicio,
        availableSlots: ['10:00'],
        ...(bookingDate ? { bookingDate } : {}),
      },
    },
  };
}

beforeAll(async () => {
  const { rows } = await db.query<{ id: string; name: string; timezone: string }>(
    `SELECT id, name, timezone FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenant = { id: rows[0].id, name: rows[0].name };
  tzOriginal = rows[0].timezone;

  const { rows: srv } = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM services WHERE tenant_id = $1 AND is_active = true LIMIT 1`,
    [tenant.id],
  );
  servicio = { id: srv[0].id, name: srv[0].name, price: 2_500_000, minutes: 30 };
});

afterAll(async () => {
  await db.query(`UPDATE tenants SET timezone = $1 WHERE id = $2`, [tzOriginal, tenant.id]);
  olvidarTimezone(tenant.id);

  // Los pasos que dan de alta crean cliente y vehiculo de verdad. Sin esto la
  // segunda corrida choca contra la placa unica por tenant.
  await db.query(
    `DELETE FROM vehicles WHERE tenant_id = $1 AND plate LIKE 'PAL%'`,
    [tenant.id],
  );
  await db.query(
    `DELETE FROM customers WHERE tenant_id = $1 AND wa_lid LIKE '999000444%'`,
    [tenant.id],
  );
  await db.pool.end();
});

describe('sumarDias', () => {
  it('avanza un día sin consultar el reloj', () => {
    expect(sumarDias('2026-09-08', 1)).toBe('2026-09-09');
  });

  it('cruza fin de mes, fin de año y año bisiesto', () => {
    expect(sumarDias('2026-09-30', 1)).toBe('2026-10-01');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('acepta días negativos', () => {
    expect(sumarDias('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('rechaza lo que no es una fecha, en vez de devolver NaN', () => {
    expect(() => sumarDias('mañana', 1)).toThrow(/Fecha inválida/);
  });
});

describe('la fecha, cuando el lavadero y UTC están en días distintos', () => {
  it('la zona elegida realmente pone al lavadero en otro día', async () => {
    // Guardia del propio test: si esto no se cumple, las pruebas siguientes
    // pasarían con el código viejo por coincidencia y no probarían nada.
    const hoyLavadero = await ponerLavaderoEnOtroDia();
    expect(hoyLavadero).not.toBe(new Date().toISOString().split('T')[0]);
  });

  it('confirma con el día del lavadero y lo llama "Hoy"', async () => {
    const hoyLavadero = await ponerLavaderoEnOtroDia();

    const r = await booking.handle(sesionEnHorarios(hoyLavadero));

    expect(r.data.bookingDate).toBe(hoyLavadero);
    expect(r.data.bookingDate).not.toBe(new Date().toISOString().split('T')[0]);
    // La etiqueta se comparaba contra UTC: decía "Mañana" para un turno de hoy.
    expect(r.messages.join('\n')).toContain('Hoy');
  });

  it('sin fecha en la sesión toma la del lavadero, no la del servidor', async () => {
    const hoyLavadero = await ponerLavaderoEnOtroDia();

    const r = await booking.handle(sesionEnHorarios());

    expect(r.data.bookingDate).toBe(hoyLavadero);
  });

  it('mañana es el día siguiente al del lavadero', async () => {
    const hoyLavadero = await ponerLavaderoEnOtroDia();

    const r = await booking.handle({
      ...sesionEnHorarios(hoyLavadero),
      text: 'M',
    });

    // Puede no quedar cupo mañana; lo que importa es contra qué día se calculó.
    if (r.data.bookingDate) {
      expect(r.data.bookingDate).toBe(sumarDias(hoyLavadero, 1));
    }
    expect(r.messages.join('\n')).toContain('mañana');
  });
});

describe('el flujo acepta la opción escrita, no sólo el número', () => {
  it('«Sedan» avanza igual que «1»', async () => {
    // El caso literal de la prueba en producción: el cliente respondió con la
    // palabra que el menú acababa de mostrarle y el bot le pidió un número.
    // Placas distintas: el paso da de alta el vehiculo y la placa es unica por
    // tenant, asi que repetirla haria fallar el segundo alta y la prueba
    // acusaria al codigo de algo que es del montaje.
    const sesion = (text: string, plate: string, lid: string) => ({
      tenant,
      waLid: lid,
      text,
      session: {
        step: 'awaiting_vehicle_type',
        data: { plate, firstName: 'Ana', lastName: 'Palabra' },
      },
    });

    const conPalabra = await booking.handle(sesion('Sedan', 'PAL001', '99900044400001@lid'));
    const conNumero = await booking.handle(sesion('1', 'PAL011', '99900044400011@lid'));

    // Ambos pasan del tipo de vehículo a elegir servicio.
    expect(conPalabra.nextStep).toBe('awaiting_service');
    expect(conNumero.nextStep).toBe('awaiting_service');
  });

  it('lo que no se entiende sigue repreguntando, y dice cómo responder', async () => {
    const r = await booking.handle({
      tenant,
      waLid: '99900044400002@lid',
      text: 'lo de siempre',
      session: {
        step: 'awaiting_vehicle_type',
        data: { plate: 'PAL002', firstName: 'Ana', lastName: 'Palabra' },
      },
    });

    expect(r.nextStep).toBe('awaiting_vehicle_type');
    expect(r.retry).toBe(true);
    // El mensaje de error ahora ofrece las dos formas.
    expect(r.messages.join('\n')).toMatch(/sedán/i);
  });

  it('el servicio se elige por su nombre', async () => {
    await ponerLavaderoALasHoras(9);
    const servicios = [
      { id: servicio.id, name: 'Lavado Express', price: 2_500_000, minutes: 30 },
      { id: servicio.id, name: 'Detailing', price: 12_000_000, minutes: 90 },
    ];

    const r = await booking.handle({
      tenant,
      waLid: '99900044400003@lid',
      text: 'Detailing',
      session: { step: 'awaiting_service', data: { plate: 'PAL003', services: servicios } },
    });

    expect(r.data.selectedService.name).toBe('Detailing');
  });
});

describe('la opción de mañana se anuncia', () => {
  const elegirServicio = {
    tenant: null as unknown,
    waLid: '99900033300003@lid',
    text: '1',
    session: { step: 'awaiting_service', data: { plate: 'FEC003', services: [] as unknown[] } },
  };

  /** El mismo paso, con el servicio ya cargado en la sesión. */
  function pedirHorarios() {
    return { ...elegirServicio, tenant, session: { ...elegirServicio.session, data: { plate: 'FEC003', services: [servicio] } } };
  }

  it('cuando hay cupos hoy, junto a la lista de horarios', async () => {
    await ponerLavaderoALasHoras(9);   // recién abierto: quedan cupos

    const r = await booking.handle(pedirHorarios());

    expect(r.data.availableSlots.length).toBeGreaterThan(0);
    // Existía desde siempre y ningún mensaje la nombraba: un cliente preguntó
    // si sólo se podía agendar para el mismo día.
    expect(r.messages.join('\n')).toContain('*M*');
  });

  it('cuando ya no quedan cupos hoy, que es cuando más sirve', async () => {
    await ponerLavaderoALasHoras(18);  // media hora antes del cierre

    const r = await booking.handle(pedirHorarios());

    expect(r.data.availableSlots).toHaveLength(0);
    expect(r.messages.join('\n')).toContain('*M*');
    // Y se queda en el paso que entiende la M, en vez de volver a los
    // servicios: antes quedarse sin cupo hoy dejaba al cliente sin salida.
    expect(r.nextStep).toBe('awaiting_time');
  });
});
