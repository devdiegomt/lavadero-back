/**
 * Rastro de acciones del personal.
 *
 * La brecha: sólo existía `appointment_status_log`. Quién desactivó un usuario,
 * quién cambió un precio, quién borró un cliente o quién tocó las credenciales
 * de facturación no quedaba en ningún lado — la respuesta a "¿quién hizo esto?"
 * era "no se puede saber".
 *
 * Lo que más importa probar son los dos límites:
 *
 * 1. **Que no guarde valores.** Si guardara los del cuerpo, la bitácora sería
 *    una segunda copia de los datos personales —con su propia obligación de
 *    retención— y arrastraría secretos de paso.
 * 2. **Que no pueda romper una petición.** Una bitácora que tumba el trabajo del
 *    lavadero cuando falla es peor que no tenerla.
 */
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';
import { purgarAuditoriaVieja } from '../src/shared/db/retencion';
import { cruzandoTenants } from './helpers/rls';

interface Fila {
  id: string;
  user_email: string | null;
  user_role: string | null;
  method: string;
  route: string;
  entity: string | null;
  entity_id: string | null;
  status_code: number;
  fields: string[] | null;
  ip: string | null;
}

let token = '';
let tokenOperador = '';
let tenantId = '';
let operadorId = '';
/** El hash original del operador. La prueba de la contraseña lo cambia. */
let hashOperador = '';

/** Lo registrado para una ruta, de lo más nuevo. */
async function registros(entity?: string): Promise<Fila[]> {
  const { rows } = await db.queryAdmin<Fila>(
    `SELECT * FROM action_log
     WHERE tenant_id = $1 ${entity ? 'AND entity = $2' : ''}
     ORDER BY created_at DESC`,
    entity ? [tenantId, entity] : [tenantId],
  );
  return rows;
}

/**
 * El `INSERT` va en `res.on('finish')`, después de que la respuesta salió: es lo
 * que evita sumarle latencia a quien espera. Así que al volver de supertest la
 * fila puede no estar todavía.
 */
async function esperarRegistro(entity: string, intentos = 40): Promise<Fila[]> {
  for (let i = 0; i < intentos; i++) {
    const filas = await registros(entity);
    if (filas.length > 0) return filas;
    await new Promise((r) => setTimeout(r, 25));
  }
  return [];
}

beforeAll(async () => {
  const { rows } = await db.queryAdmin<{ id: string }>(
    `SELECT id FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  tenantId = rows[0].id;

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@elbrillante.co', password: 'admin123' });
  token = login.body.accessToken;
  expect(token).toBeTruthy();

  const { rows: op } = await db.queryAdmin<{ id: string; email: string; password_hash: string }>(
    `SELECT id, email, password_hash FROM users
     WHERE role = 'operator' AND tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  operadorId = op[0].id;
  hashOperador = op[0].password_hash;

  const loginOp = await request(app)
    .post('/api/auth/login')
    .send({ email: op[0].email, password: 'admin123' });  // el seed usa la misma para todos
  tokenOperador = loginOp.body.accessToken ?? '';
  // Sin esto las pruebas de permisos pasarían sin probar nada.
  expect(tokenOperador).toBeTruthy();
});

beforeEach(async () => {
  await db.queryAdmin(`DELETE FROM action_log WHERE tenant_id = $1`, [tenantId]);
});

afterAll(async () => {
  await db.queryAdmin(`DELETE FROM action_log WHERE tenant_id = $1`, [tenantId]);
  await db.queryAdmin(`DELETE FROM customers WHERE first_name = 'Auditado'`);
  // La prueba de la contraseña le cambia la clave al operador del seed. Sin
  // devolverla, la corrida siguiente no puede iniciar sesión como él y estas
  // mismas pruebas fallan sin relación aparente con el código. Ya pasó dos
  // veces en este proyecto, con el reloj del tenant y con un cliente renombrado.
  if (hashOperador) {
    await db.queryAdmin(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hashOperador, operadorId]);
  }
  await db.pool.end();
});

describe('qué queda registrado', () => {
  it('un alta deja quién, qué y sobre qué registro', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Auditado', phone: '3005554433' });
    expect(res.status).toBe(201);

    const filas = await esperarRegistro('customers');
    expect(filas).toHaveLength(1);

    const f = filas[0];
    expect(f.method).toBe('POST');
    expect(f.route).toBe('/api/customers/');
    expect(f.user_email).toBe('admin@elbrillante.co');
    expect(f.user_role).toBe('admin');
    expect(f.status_code).toBe(201);
    // El id sale del cuerpo de la respuesta: en un POST todavía no existe
    // cuando llega la petición.
    expect(f.entity_id).toBe(res.body.id);
  });

  it('un PATCH registra el id que venía en la ruta', async () => {
    const { rows } = await db.queryAdmin<{ id: string }>(
      `SELECT id FROM customers WHERE tenant_id = $1 LIMIT 1`, [tenantId],
    );

    await request(app)
      .patch(`/api/customers/${rows[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'una nota' });

    const filas = await esperarRegistro('customers');
    expect(filas[0].entity_id).toBe(rows[0].id);
    // El patrón de la ruta, no la URL con el id adentro: así se puede agrupar
    // por acción en vez de tener una ruta distinta por registro.
    expect(filas[0].route).toBe('/api/customers/:id');
  });

  it('un intento rechazado también queda: es lo más interesante de mirar', async () => {
    // Un operador no puede tocar servicios. Que el intento no deje rastro sería
    // perder justamente el registro que importa.
    if (!tokenOperador) throw new Error('sin token de operador: la prueba no probaría nada');

    const { rows } = await db.queryAdmin<{ id: string }>(
      `SELECT id FROM services WHERE tenant_id = $1 LIMIT 1`, [tenantId],
    );
    const res = await request(app)
      .patch(`/api/services/${rows[0].id}`)
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ name: 'Intento' });
    expect(res.status).toBe(403);

    const filas = await esperarRegistro('services');
    expect(filas).toHaveLength(1);
    expect(filas[0].status_code).toBe(403);
    expect(filas[0].user_role).toBe('operator');
  });

  it('los GET no se registran: son casi todo el tráfico', async () => {
    await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`);
    await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);

    await new Promise((r) => setTimeout(r, 150));
    expect(await registros()).toHaveLength(0);
  });

  it('wa-bridge no se registra: es n8n y ya se audita aparte', async () => {
    // Incluirlo sumaría miles de filas por día que tapan lo que se viene a ver,
    // y esas conversaciones ya están en whatsapp_messages.
    //
    // No se afirma nada sobre el status: el bridge tiene su propio limitador por
    // cliente, y otra suite puede haber gastado la cuota de ese número. Lo que
    // se prueba acá es la exclusión, que vale igual si la petición fue rechazada.
    await request(app)
      .post('/api/wa-bridge/log')
      .set('x-api-key', process.env.N8N_API_KEY ?? '')
      .set('x-tenant-phone', process.env.TENANT_PHONE ?? '')
      .send({ phone: '+57300' + Date.now().toString().slice(-7), direction: 'inbound', content: 'hola' });

    await new Promise((r) => setTimeout(r, 150));
    expect(await registros()).toHaveLength(0);
  });
});

describe('lo que NO se guarda', () => {
  it('guarda los nombres de los campos, nunca los valores', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Auditado', phone: '3007778899', notes: 'dato sensible del cliente' });
    expect(res.status).toBe(201);

    const filas = await esperarRegistro('customers');
    expect(filas[0].fields).toEqual(expect.arrayContaining(['firstName', 'phone', 'notes']));

    // Y en ninguna columna de la fila aparece el contenido.
    const completa = JSON.stringify(filas[0]);
    expect(completa).not.toContain('dato sensible del cliente');
    expect(completa).not.toContain('3007778899');
  });

  it('una contraseña no deja ni rastro de su valor', async () => {
    // Usuario propio y descartable. Cambiarle la clave al operador del seed
    // dejaba la base en un estado donde la corrida siguiente no podía iniciar
    // sesión como él, y estas mismas pruebas fallaban sin relación aparente con
    // el código. Restaurar en `afterAll` no alcanza: si el proceso se corta a
    // mitad, el estado queda igual de roto.
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: `auditado-${Date.now()}@elbrillante.co`,
        password: 'Provisoria123',
        firstName: 'Auditado',
        role: 'operator',
      });
    expect(res.status).toBe(201);
    const usuarioId = res.body.id;
    await db.queryAdmin(`DELETE FROM action_log WHERE tenant_id = $1`, [tenantId]);

    await request(app)
      .patch(`/api/users/${usuarioId}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'SuperSecreta123' });

    const filas = await esperarRegistro('users');
    expect(filas).toHaveLength(1);
    // El nombre del campo sí: saber que alguien cambió una contraseña es el
    // punto. El valor, nunca.
    expect(filas[0].fields).toContain('newPassword');
    expect(JSON.stringify(filas[0])).not.toContain('SuperSecreta123');

    await db.queryAdmin(`DELETE FROM refresh_tokens WHERE user_id = $1`, [usuarioId]);
    await db.queryAdmin(`DELETE FROM users WHERE id = $1`, [usuarioId]);
  });

  it('la credencial de facturación tampoco', async () => {
    const TOKEN_ALEGRA = 'alegra-token-que-no-debe-quedar-1234';
    await request(app)
      .put('/api/billing/config/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'conta@elbrillante.co', token: TOKEN_ALEGRA });

    const filas = await esperarRegistro('billing');
    expect(filas).toHaveLength(1);
    expect(JSON.stringify(filas[0])).not.toContain(TOKEN_ALEGRA);

    await db.queryAdmin(
      `UPDATE tenants SET billing_provider = NULL, billing_api_key = NULL WHERE id = $1`,
      [tenantId],
    );
  });
});

describe('no puede romper nada', () => {
  it('si el INSERT falla, la petición ya respondió igual', async () => {
    // El fallo se provoca en el INSERT de la bitácora y nada más. La primera
    // versión renombraba la tabla, y eso exige ser dueño: con el rol de la
    // aplicación —que es como corre en producción, ver rls.test.ts— no se puede.
    // Interceptar la consulta además es más preciso: rompe exactamente lo que se
    // quiere romper.
    const real = db.query.bind(db);
    const espia = jest
      .spyOn(db, 'query')
      .mockImplementation(async (texto: string, params?: unknown[]) => {
        if (texto.includes('action_log')) throw new Error('bitácora caída');
        return real(texto, params as never);
      });

    try {
      const res = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Auditado', phone: '3006665544' });

      // Lo que importa: el lavadero pudo trabajar igual.
      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      // Y el fallo tuvo tiempo de ocurrir sin tumbar el proceso.
      await new Promise((r) => setTimeout(r, 150));
    } finally {
      espia.mockRestore();
    }
  });
});

describe('se puede consultar, que es para lo que existe', () => {
  it('GET /api/audit devuelve lo registrado, de lo más nuevo', async () => {
    await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Auditado', phone: '3004443322' });
    await esperarRegistro('customers');

    const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].entity).toBe('customers');
    // Se dice explícitamente para que nadie espere encontrar valores acá.
    expect(res.body.nota).toMatch(/nunca sus valores/);
  });

  it('filtra por registro: "¿quién tocó esto?"', async () => {
    const creado = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Auditado', phone: '3002221100' });
    await esperarRegistro('customers');

    const res = await request(app)
      .get(`/api/audit?entity=customers&entityId=${creado.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].entity_id).toBe(creado.body.id);
  });

  it('filtra sólo los intentos rechazados', async () => {
    if (!tokenOperador) throw new Error('sin token de operador');
    const { rows } = await db.queryAdmin<{ id: string }>(
      `SELECT id FROM services WHERE tenant_id = $1 LIMIT 1`, [tenantId],
    );
    await request(app)
      .patch(`/api/services/${rows[0].id}`)
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ name: 'Intento' });
    await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Auditado', phone: '3001110099' });
    await esperarRegistro('customers');

    const res = await request(app)
      .get('/api/audit?soloFallidas=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const fila of res.body.data) expect(fila.status_code).toBeGreaterThanOrEqual(400);
  });

  it('un operador no puede leer la bitácora', async () => {
    if (!tokenOperador) throw new Error('sin token de operador');
    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${tokenOperador}`);
    expect(res.status).toBe(403);
  });

  it('un filtro malformado da 400, no 500', async () => {
    const res = await request(app)
      .get('/api/audit?entityId=no-es-uuid')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('retención', () => {
  it('purga lo vencido y deja lo reciente', async () => {
    await db.queryAdmin(
      `INSERT INTO action_log (tenant_id, method, route, status_code, created_at)
       VALUES ($1, 'POST', '/api/viejo', 201, NOW() - INTERVAL '30 months'),
              ($1, 'POST', '/api/nuevo', 201, NOW())`,
      [tenantId],
    );

    const borrados = await cruzandoTenants(() => purgarAuditoriaVieja(24));
    expect(borrados).toBeGreaterThanOrEqual(1);

    const rutas = (await registros()).map((f) => f.route);
    expect(rutas).toContain('/api/nuevo');
    expect(rutas).not.toContain('/api/viejo');
  });

  it('con 0 meses no purga nada: el plazo lo decide el responsable', async () => {
    await db.queryAdmin(
      `INSERT INTO action_log (tenant_id, method, route, status_code, created_at)
       VALUES ($1, 'POST', '/api/viejisimo', 201, NOW() - INTERVAL '10 years')`,
      [tenantId],
    );

    expect(await cruzandoTenants(() => purgarAuditoriaVieja(0))).toBe(0);
    expect((await registros()).map((f) => f.route)).toContain('/api/viejisimo');
  });
});
