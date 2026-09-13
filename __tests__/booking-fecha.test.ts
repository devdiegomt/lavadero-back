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
import { conTenant } from './helpers/rls';
import {
  sumarDias, getTenantToday, olvidarTimezone, diaDeLaSemana,
  diasAgendables, etiquetaDeDia, nombreDelDia,
} from '../src/shared/utils/dateUtils';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const booking = require('../src/modules/whatsapp/flows/booking');

let tenant: { id: string; name: string };
let tzOriginal: string;
let servicio: { id: string; name: string; price: number; minutes: number };

/**
 * Corre la prueba dentro del contexto de tenant, como lo haría una petición.
 * Con RLS activo, llamar estas funciones sin contexto no ve ninguna fila: las
 * políticas fallan cerrado a propósito. Ver helpers/rls.ts.
 */
const itEnTenant = (nombre: string, fn: () => Promise<void>): void => {
  it(nombre, () => conTenant(tenant.id, fn));
};


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

  await db.queryAdmin(`UPDATE tenants SET timezone = $1 WHERE id = $2`, [tz, tenant.id]);
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

  await db.queryAdmin(
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
  const { rows } = await db.queryAdmin<{ id: string; name: string; timezone: string }>(
    `SELECT id, name, timezone FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenant = { id: rows[0].id, name: rows[0].name };
  tzOriginal = rows[0].timezone;

  const { rows: srv } = await db.queryAdmin<{ id: string; name: string }>(
    `SELECT id, name FROM services WHERE tenant_id = $1 AND is_active = true LIMIT 1`,
    [tenant.id],
  );
  servicio = { id: srv[0].id, name: srv[0].name, price: 2_500_000, minutes: 30 };
});

afterAll(async () => {
  await db.queryAdmin(`UPDATE tenants SET timezone = $1 WHERE id = $2`, [tzOriginal, tenant.id]);
  olvidarTimezone(tenant.id);

  // Los pasos que dan de alta crean cliente y vehiculo de verdad. Sin esto la
  // segunda corrida choca contra la placa unica por tenant.
  await db.queryAdmin(
    `DELETE FROM vehicles WHERE tenant_id = $1 AND plate LIKE 'PAL%'`,
    [tenant.id],
  );
  await db.queryAdmin(
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

describe('qué días se pueden agendar', () => {
  // 2026-09-12 es sábado; el 13, domingo.
  const SABADO = '2026-09-12';

  it('salta los días de cierre', () => {
    const dias = diasAgendables(SABADO, 7, [0]);
    expect(dias).not.toContain('2026-09-13');
    expect(dias[0]).toBe(SABADO);
    expect(dias[1]).toBe('2026-09-14');
  });

  it('la ventana se cuenta en días de calendario, no en días abiertos', () => {
    // "Hasta 7 días" es "hasta el mismo día de la semana que viene", que es lo
    // que entiende un cliente. Con domingo cerrado quedan 6 días abiertos.
    const dias = diasAgendables(SABADO, 7, [0]);
    expect(dias).toHaveLength(6);
    expect(dias[dias.length - 1]).toBe('2026-09-18');
  });

  it('sin días de cierre devuelve la ventana entera', () => {
    expect(diasAgendables(SABADO, 7, [])).toHaveLength(7);
  });

  it('un lavadero que cierra otro día no queda atado al domingo', () => {
    // El motivo de que esto sea configuración del tenant y no una constante.
    const cierraLunes = diasAgendables(SABADO, 7, [1]);
    expect(cierraLunes).toContain('2026-09-13'); // domingo, abre
    expect(cierraLunes).not.toContain('2026-09-14'); // lunes, cierra
  });

  it('una ventana de un día deja sólo hoy', () => {
    expect(diasAgendables(SABADO, 1, [0])).toEqual([SABADO]);
  });

  it('etiqueta hoy y mañana por su nombre, y el resto con el número', () => {
    expect(etiquetaDeDia(SABADO, SABADO)).toBe('Hoy');
    expect(etiquetaDeDia('2026-09-13', SABADO)).toBe('Mañana');
    // "El viernes" a secas sería ambiguo entre este y el siguiente.
    expect(etiquetaDeDia('2026-09-18', SABADO)).toBe('Viernes 18');
  });
});

describe('la fecha, cuando el lavadero y UTC están en días distintos', () => {
  itEnTenant('la zona elegida realmente pone al lavadero en otro día', async () => {
    // Guardia del propio test: si esto no se cumple, las pruebas siguientes
    // pasarían con el código viejo por coincidencia y no probarían nada.
    const hoyLavadero = await ponerLavaderoEnOtroDia();
    expect(hoyLavadero).not.toBe(new Date().toISOString().split('T')[0]);
  });

  itEnTenant('confirma con el día del lavadero y lo llama "Hoy"', async () => {
    const hoyLavadero = await ponerLavaderoEnOtroDia();

    const r = await booking.handle(sesionEnHorarios(hoyLavadero));

    expect(r.data.bookingDate).toBe(hoyLavadero);
    expect(r.data.bookingDate).not.toBe(new Date().toISOString().split('T')[0]);
    // La etiqueta se comparaba contra UTC: decía "Mañana" para un turno de hoy.
    expect(r.messages.join('\n')).toContain('Hoy');
  });

  itEnTenant('sin fecha en la sesión toma la del lavadero, no la del servidor', async () => {
    const hoyLavadero = await ponerLavaderoEnOtroDia();

    const r = await booking.handle(sesionEnHorarios());

    expect(r.data.bookingDate).toBe(hoyLavadero);
  });
});

describe('elegir el día', () => {
  itEnTenant('tras el servicio pregunta por el día, dentro de la ventana y sin domingos', async () => {
    await ponerLavaderoALasHoras(9);
    const hoy = await getTenantToday(tenant.id);

    const r = await booking.handle({
      tenant,
      waLid: '99900055500001@lid',
      text: '1',
      session: { step: 'awaiting_service', data: { plate: 'DIA001', services: [servicio] } },
    });

    expect(r.nextStep).toBe('awaiting_date');
    expect(r.messages.join('\n')).toMatch(/qué día/i);

    const fechas = r.data.diasOfrecidos.map((d: { fecha: string }) => d.fecha);
    // Ninguno cae en domingo, que es el día de cierre por defecto del tenant.
    for (const f of fechas) expect(diaDeLaSemana(f)).not.toBe(0);
    // Ninguno se sale de la ventana de 7 días.
    for (const f of fechas) expect(f <= sumarDias(hoy, 6)).toBe(true);
  });

  itEnTenant('el día se elige escribiendo su nombre a secas', async () => {
    // El caso real: en producción el cliente escribió «lunes» y el bot no lo
    // entendió. La primera versión de esta prueba usaba la etiqueta completa
    // —«Lunes 14»— y pasaba: probaba el caso que ya funcionaba, no el que
    // ocurre. `elegirOpcion` busca la clave DENTRO del texto, y aquí el
    // cliente escribe MENOS que la etiqueta.
    await ponerLavaderoALasHoras(9);
    const paso1 = await booking.handle({
      tenant,
      waLid: '99900055500002@lid',
      text: '1',
      session: { step: 'awaiting_service', data: { plate: 'DIA002', services: [servicio] } },
    });

    // Un día que no sea hoy ni mañana: los que llevan nombre de día.
    const conNombre = paso1.data.diasOfrecidos.find(
      (d: { etiqueta: string }) => !['Hoy', 'Mañana'].includes(d.etiqueta),
    );
    expect(conNombre).toBeDefined();

    const soloElNombre = nombreDelDia(conNombre.fecha).toLowerCase();
    const r = await booking.handle({
      tenant,
      waLid: '99900055500002@lid',
      text: soloElNombre,
      session: { step: 'awaiting_date', data: paso1.data },
    });

    expect(r.nextStep).toBe('awaiting_time');
    expect(r.data.bookingDate).toBe(conNombre.fecha);
  });

  itEnTenant('la etiqueta completa también vale', async () => {
    await ponerLavaderoALasHoras(9);
    const paso1 = await booking.handle({
      tenant,
      waLid: '99900055500005@lid',
      text: '1',
      session: { step: 'awaiting_service', data: { plate: 'DIA005', services: [servicio] } },
    });
    const segundo = paso1.data.diasOfrecidos[1];

    const r = await booking.handle({
      tenant,
      waLid: '99900055500005@lid',
      text: segundo.etiqueta,
      session: { step: 'awaiting_date', data: paso1.data },
    });

    expect(r.data.bookingDate).toBe(segundo.fecha);
  });

  itEnTenant('un día que no se ofreció hace repreguntar', async () => {
    await ponerLavaderoALasHoras(9);
    const paso1 = await booking.handle({
      tenant,
      waLid: '99900055500003@lid',
      text: '1',
      session: { step: 'awaiting_service', data: { plate: 'DIA003', services: [servicio] } },
    });

    const r = await booking.handle({
      tenant,
      waLid: '99900055500003@lid',
      text: '99',
      session: { step: 'awaiting_date', data: paso1.data },
    });

    expect(r.nextStep).toBe('awaiting_date');
    expect(r.retry).toBe(true);
  });

  itEnTenant('la confirmación nombra el día elegido, no siempre "Hoy" o "Mañana"', async () => {
    await ponerLavaderoALasHoras(9);
    const paso1 = await booking.handle({
      tenant,
      waLid: '99900055500004@lid',
      text: '1',
      session: { step: 'awaiting_service', data: { plate: 'DIA004', services: [servicio] } },
    });
    const ultimo = paso1.data.diasOfrecidos[paso1.data.diasOfrecidos.length - 1];

    const conHorarios = await booking.handle({
      tenant,
      waLid: '99900055500004@lid',
      text: ultimo.etiqueta,
      session: { step: 'awaiting_date', data: paso1.data },
    });
    const confirmar = await booking.handle({
      tenant,
      waLid: '99900055500004@lid',
      text: '1',
      session: { step: 'awaiting_time', data: conHorarios.data },
    });

    // Antes la etiqueta salía de un ternario Hoy/Mañana, así que con una
    // ventana de varios días habría dicho "Mañana" para el viernes.
    expect(confirmar.messages.join('\n')).toContain(ultimo.etiqueta);
  });
});

describe('el flujo acepta la opción escrita, no sólo el número', () => {
  itEnTenant('«Sedan» avanza igual que «1»', async () => {
    // El caso literal de la prueba en producción: el cliente respondió con la
    // palabra que el menú acababa de mostrarle y el bot le pidió un número.
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

    expect(conPalabra.nextStep).toBe('awaiting_service');
    expect(conNumero.nextStep).toBe('awaiting_service');
  });

  itEnTenant('lo que no se entiende sigue repreguntando, y dice cómo responder', async () => {
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
    expect(r.messages.join('\n')).toMatch(/sedán/i);
  });

  itEnTenant('el servicio se elige por su nombre', async () => {
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
