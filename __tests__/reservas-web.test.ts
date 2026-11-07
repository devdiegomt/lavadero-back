/**
 * La página pública de reservas: `/api/publico/lavaderos/:slug/reservas`.
 *
 * Es la primera ruta anónima que **escribe**. Lo que se prueba es lo que la
 * hace segura sin sesión: que exija la autorización de datos, que no revele
 * nada de lo que ya hay en la base, que respete los cupos, y que sus topes
 * funcionen. Ver src/modules/publico/reservas.ts.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';
import { VERSION_AVISO_LAVADERO } from '../src/modules/whatsapp/consentimiento';
import { horasLibres, MAX_PENDIENTES_POR_TELEFONO } from '../src/modules/publico/reservas';

const BASE = '/api/publico/lavaderos/el-brillante/reservas';
const TEL: string[] = ['+573118880001', '+573118880002', '+573118880003', '+573118880004', '+573118880005'];
const PLACAS: string[] = ['WEB001', 'WEB002', 'WEB003', 'WEB004', 'WEB005', 'WEB006'];

interface Servicio { id: string; nombre: string; minutos: number; precios: Record<string, number | null> }
interface Dia { fecha: string; etiqueta: string; horas: string[] }

let servicios: Servicio[];
let completo: Servicio;

async function limpiar(): Promise<void> {
  await db.queryAdmin(
    `DELETE FROM appointment_status_log WHERE appointment_id IN
       (SELECT a.id FROM appointments a JOIN customers c ON c.id = a.customer_id WHERE c.phone = ANY($1))`,
    [TEL],
  );
  await db.queryAdmin(
    `DELETE FROM appointments WHERE customer_id IN (SELECT id FROM customers WHERE phone = ANY($1))`,
    [TEL],
  );
  await db.queryAdmin(`DELETE FROM vehicles WHERE UPPER(plate) = ANY($1)`, [PLACAS]);
  await db.queryAdmin(`DELETE FROM customers WHERE phone = ANY($1)`, [TEL]);
}

const diasPara = async (servicioId: string): Promise<Dia[]> =>
  (await request(app).get(`${BASE}/horarios`).query({ servicio: servicioId })).body.dias;

/**
 * Cupos que quedan en una hora, contados en la base en el momento.
 *
 * Jest corre los archivos en paralelo y otras suites —las del bot de WhatsApp—
 * reservan en la misma agenda: suponer que una hora está vacía hizo fallar esta
 * suite en CI (entraron 2 de 3 porque el bot tenía la tercera bahía). Por eso
 * las pruebas de cupos usan el último día de la ventana, que nadie más toca, y
 * además cuentan lo que ya hay en vez de suponerlo.
 */
async function cuposLibres(fecha: string, hora: string, minutos: number): Promise<number> {
  const { rows } = await db.queryAdmin<{ bahias: number; ocupadas: string }>(
    `SELECT t.bays_count AS bahias,
            (SELECT COUNT(*) FROM appointments a JOIN services s ON s.id = a.service_id
              WHERE a.tenant_id = t.id AND a.scheduled_date = $1 AND a.scheduled_time IS NOT NULL
                AND a.status NOT IN ('cancelled', 'delivered', 'done')
                AND a.scheduled_time < $2::time + make_interval(mins => $3)
                AND a.scheduled_time + make_interval(mins => COALESCE(s.estimated_minutes, 60)) > $2::time
            ) AS ocupadas
       FROM tenants t WHERE t.slug = 'el-brillante'`,
    [fecha, hora, minutos],
  );
  return rows[0].bahias - parseInt(rows[0].ocupadas, 10);
}

/** El último día de la ventana con horas libres: ninguna otra suite reserva ahí. */
const ultimoDia = async (servicioId: string): Promise<Dia> => {
  const dias = await diasPara(servicioId);
  return dias[dias.length - 1];
};

const reserva = (extra: Record<string, unknown>) => ({
  autorizaDatos: true,
  servicioId: completo.id,
  tipoVehiculo: 'sedan',
  nombre: 'Ana',
  telefono: TEL[0],
  placa: PLACAS[0],
  ...extra,
});

beforeAll(async () => {
  await limpiar();
  const res = await request(app).get(BASE);
  servicios = res.body.servicios;
  completo = servicios.find((s) => s.nombre === 'Lavado Completo')!;
});

afterAll(async () => {
  await limpiar();
  await db.queryAdmin(`UPDATE tenants SET subscription_status = 'active' WHERE slug = 'el-brillante'`);
  await db.pool.end();
});

describe('horasLibres', () => {
  const base = { apertura: '08:00:00', cierre: '12:00:00', bahias: 1, ocupados: [] };

  it('el servicio tiene que terminar antes del cierre', () => {
    expect(horasLibres({ ...base, minutosServicio: 90 })).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00', '10:30']);
  });

  it('no ofrece un horario que choca con un turno que empieza después', () => {
    // Turno de 10:00 a 11:00 en la única bahía: un servicio de 90 minutos no
    // puede empezar a las 9:00, aunque a las 9:00 la bahía esté libre.
    const horas = horasLibres({ ...base, minutosServicio: 90, ocupados: [{ inicio: 600, minutos: 60 }] });
    expect(horas).toEqual(['08:00', '08:30']);
  });

  it('con dos bahías, un turno no bloquea el horario', () => {
    const horas = horasLibres({ ...base, bahias: 2, minutosServicio: 60, ocupados: [{ inicio: 540, minutos: 60 }] });
    expect(horas).toContain('09:00');
  });

  it('si es hoy, deja media hora de margen desde ahora', () => {
    const horas = horasLibres({ ...base, minutosServicio: 30, ahora: 9 * 60 + 10 });
    expect(horas[0]).toBe('10:00');
  });
});

describe('lo que la página muestra', () => {
  it('servicios con precio por tipo, en pesos; sin precio es null (no se ofrece)', async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(200);
    expect(res.body.lavadero.nombre).toBeTruthy();
    expect(res.body.recibeReservas).toBe(true);
    expect(completo.precios.sedan).toBe(40000);
    expect(servicios.find((s) => s.nombre === 'Solo Aspirado')!.precios.moto).toBeNull();
  });

  it('no dice nada de clientes, usuarios ni plan', async () => {
    const texto = JSON.stringify((await request(app).get(BASE)).body);
    expect(texto).not.toMatch(/customer|cliente|email|plan|nit|tenant_id/i);
  });

  it('un lavadero que no existe, o un slug raro, es 404', async () => {
    expect((await request(app).get('/api/publico/lavaderos/no-existe/reservas')).status).toBe(404);
    expect((await request(app).get('/api/publico/lavaderos/a%27or%201=1/reservas')).status).toBe(404);
  });

  it('los horarios caen dentro de la ventana y nunca en domingo (día de cierre)', async () => {
    const dias = await diasPara(completo.id);
    expect(dias.length).toBeGreaterThan(0);
    expect(dias.length).toBeLessThanOrEqual(7);
    for (const d of dias) expect(new Date(`${d.fecha}T12:00:00Z`).getUTCDay()).not.toBe(0);
  });
});

describe('reservar', () => {
  beforeEach(limpiar);

  it('sin la autorización de datos no se guarda nada', async () => {
    const [dia] = await diasPara(completo.id);
    const res = await request(app).post(BASE).send(reserva({ autorizaDatos: false, fecha: dia.fecha, hora: dia.horas[0] }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/autorizar/);
    expect((await db.queryAdmin('SELECT 1 FROM customers WHERE phone = $1', [TEL[0]])).rows).toHaveLength(0);
  });

  it('crea cliente, vehículo y turno web, con la autorización registrada', async () => {
    const [dia] = await diasPara(completo.id);
    const res = await request(app).post(BASE).send(reserva({ fecha: dia.fecha, hora: dia.horas[0], placa: 'web-001' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ servicio: 'Lavado Completo', hora: dia.horas[0], placa: 'WEB001', precio: 40000 });

    const { rows } = await db.queryAdmin<Record<string, unknown>>(
      `SELECT c.consent_source, c.consent_version, c.consent_at, a.source, a.status, a.price, v.vehicle_type
         FROM appointments a JOIN customers c ON c.id = a.customer_id JOIN vehicles v ON v.id = a.vehicle_id
        WHERE c.phone = $1`,
      [TEL[0]],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      consent_source: 'web',
      consent_version: VERSION_AVISO_LAVADERO,
      source: 'web',
      status: 'pending',
      price: 4000000,
      vehicle_type: 'sedan',
    });
    expect(rows[0].consent_at).not.toBeNull();
  });

  it('a un cliente que ya existe no le cambia el nombre ni lo revela', async () => {
    await db.queryAdmin(
      `INSERT INTO customers (tenant_id, first_name, phone)
       SELECT id, 'Nombre Original', $1 FROM tenants WHERE slug = 'el-brillante'`,
      [TEL[1]],
    );
    const [dia] = await diasPara(completo.id);
    const res = await request(app).post(BASE).send(reserva({ telefono: TEL[1], nombre: 'Otro', fecha: dia.fecha, hora: dia.horas[0] }));
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/Original/);
    const { rows } = await db.queryAdmin<{ first_name: string; consent_source: string }>(
      'SELECT first_name, consent_source FROM customers WHERE phone = $1',
      [TEL[1]],
    );
    expect(rows[0].first_name).toBe('Nombre Original');
    // Nunca había autorizado: la autorización queda registrada ahora.
    expect(rows[0].consent_source).toBe('web');
  });

  it(`un mismo teléfono no puede tener más de ${MAX_PENDIENTES_POR_TELEFONO} reservas pendientes`, async () => {
    const [dia] = await diasPara(completo.id);
    for (let i = 0; i < MAX_PENDIENTES_POR_TELEFONO; i++) {
      const r = await request(app).post(BASE).send(reserva({ fecha: dia.fecha, hora: dia.horas[i], placa: PLACAS[i] }));
      expect(r.status).toBe(201);
    }
    const res = await request(app).post(BASE).send(reserva({ fecha: dia.fecha, hora: dia.horas[2], placa: PLACAS[2] }));
    expect(res.status).toBe(409);
    expect(res.body.details?.codigo ?? res.body.codigo).toBe('TOPE_TELEFONO');
  });

  it('cuando todas las bahías están ocupadas, el horario deja de ofrecerse y no se puede tomar', async () => {
    const dia = await ultimoDia(completo.id);
    const hora = dia.horas[dia.horas.length - 1];
    const cupos = await cuposLibres(dia.fecha, hora, completo.minutos);
    expect(cupos).toBeGreaterThan(0);
    for (let i = 0; i < cupos; i++) {
      const r = await request(app).post(BASE).send(reserva({ telefono: TEL[i], placa: PLACAS[i], fecha: dia.fecha, hora }));
      expect(r.status).toBe(201);
    }
    const despues = (await diasPara(completo.id)).find((d) => d.fecha === dia.fecha);
    expect(despues?.horas ?? []).not.toContain(hora);

    const res = await request(app).post(BASE).send(reserva({ telefono: TEL[4], placa: PLACAS[5], fecha: dia.fecha, hora }));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/ocupar/);
  });

  it('ocho personas a la vez por el mismo horario: entran tantas como cupos libres', async () => {
    const dia = await ultimoDia(completo.id);
    // Una del medio: la última la usa la prueba de bahías llenas.
    const hora = dia.horas[Math.floor(dia.horas.length / 2)];
    const cupos = await cuposLibres(dia.fecha, hora, completo.minutos);
    expect(cupos).toBeGreaterThan(0);
    const tels = Array.from({ length: 8 }, (_, i) => `+5731188801${String(i).padStart(2, '0')}`);
    TEL.push(...tels);
    PLACAS.push(...tels.map((_, i) => `WEC${String(i).padStart(3, '0')}`));
    try {
      const respuestas = await Promise.all(
        tels.map((t, i) =>
          request(app).post(BASE).send(reserva({ telefono: t, placa: `WEC${String(i).padStart(3, '0')}`, fecha: dia.fecha, hora })),
        ),
      );
      const estados = respuestas.map((r) => r.status);
      // Nada de 500 ni de otra cosa: cada una entra o le dicen que se ocupó.
      expect(estados.filter((e) => e !== 201 && e !== 409)).toEqual([]);
      expect(estados.filter((e) => e === 201)).toHaveLength(cupos);
      expect(await cuposLibres(dia.fecha, hora, completo.minutos)).toBe(0);
    } finally {
      await limpiar();
    }
  });

  it('una hora que no está en la grilla se rechaza como tal, no como «ocupada»', async () => {
    const [dia] = await diasPara(completo.id);
    for (const hora of ['03:00', '09:15']) {
      const res = await request(app).post(BASE).send(reserva({ fecha: dia.fecha, hora }));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no se puede reservar/);
    }
  });

  it('el celular tiene que ser un celular: un fijo o un número inventado no pasan', async () => {
    const [dia] = await diasPara(completo.id);
    for (const telefono of ['6012345678', '1234567890', '123']) {
      const res = await request(app).post(BASE).send(reserva({ telefono, fecha: dia.fecha, hora: dia.horas[0] }));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/celular/);
    }
  });

  it('JSON roto es 400 y un cuerpo gigante 413, no un 500', async () => {
    const roto = await request(app).post(BASE).set('Content-Type', 'application/json').send('{"nombre": ');
    expect(roto.status).toBe(400);
    const gigante = await request(app).post(BASE).send({ notas: 'x'.repeat(2_000_000) });
    expect(gigante.status).toBe(413);
  });

  it('un día fuera de la ventana no se puede reservar', async () => {
    const res = await request(app).post(BASE).send(reserva({ fecha: '2099-01-05', hora: '09:00' }));
    expect(res.status).toBe(400);
  });

  it('un bot que llena el campo trampa recibe 201 y no se guarda nada', async () => {
    const [dia] = await diasPara(completo.id);
    const res = await request(app).post(BASE).send(reserva({ fecha: dia.fecha, hora: dia.horas[0], sitio: 'http://spam' }));
    expect(res.status).toBe(201);
    expect((await db.queryAdmin('SELECT 1 FROM customers WHERE phone = $1', [TEL[0]])).rows).toHaveLength(0);
  });

  it('con la suscripción suspendida, la página lo dice y no recibe reservas', async () => {
    const [dia] = await diasPara(completo.id);
    await db.queryAdmin(`UPDATE tenants SET subscription_status = 'suspended' WHERE slug = 'el-brillante'`);
    try {
      expect((await request(app).get(BASE)).body.recibeReservas).toBe(false);
      const res = await request(app).post(BASE).send(reserva({ fecha: dia.fecha, hora: dia.horas[0] }));
      expect(res.status).toBe(409);
      expect((await db.queryAdmin('SELECT 1 FROM customers WHERE phone = $1', [TEL[0]])).rows).toHaveLength(0);
    } finally {
      await db.queryAdmin(`UPDATE tenants SET subscription_status = 'active' WHERE slug = 'el-brillante'`);
    }
  });
});
