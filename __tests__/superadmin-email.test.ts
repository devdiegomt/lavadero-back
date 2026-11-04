/**
 * El superadministrador puede entrar aunque su email tenga mayúsculas.
 *
 * El login pasa el email a minúsculas antes de buscarlo (validate.ts), y el
 * registro de lavaderos también lo guarda en minúsculas. `seed-superadmin` no:
 * guardaba `SUPER_ADMIN_EMAIL` tal cual. Con una sola mayúscula en la variable
 * —`Diego@…`— el login buscaba `diego@…`, no lo encontraba, y respondía
 * «credenciales inválidas» con la contraseña correcta. Para siempre: ninguna
 * ruta de la API deja cambiar el email del superadministrador.
 *
 * Apareció en producción, recién creada la base en Supabase.
 *
 * Se corre el script de verdad, como proceso aparte, porque el error estaba en
 * lo que el script escribe —no en una función que se pueda llamar suelta—.
 */
import { spawnSync } from 'child_process';
import request from 'supertest';
import app from '../src/index';
import * as db from '../src/shared/db';

const EMAIL_CON_MAYUSCULAS = 'Super.Mayus@Qlarity.TEST';
const EMAIL = EMAIL_CON_MAYUSCULAS.toLowerCase();
const PASSWORD = 'clave-de-prueba-superadmin-1';

function sembrar(email: string, password: string): string {
  const r = spawnSync(
    'npx',
    ['ts-node', '--transpile-only', '-r', 'dotenv/config', 'src/shared/db/seed-superadmin.ts'],
    { env: { ...process.env, SUPER_ADMIN_EMAIL: email, SUPER_ADMIN_PASSWORD: password }, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`seed-superadmin falló:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

const borrar = () =>
  db.queryAdmin(`DELETE FROM users WHERE LOWER(email) = $1 AND role = 'super_admin'`, [EMAIL]);

beforeEach(borrar);
afterAll(async () => {
  await borrar();
  await db.pool.end();
});

describe('seed-superadmin con un email con mayúsculas', () => {
  it('lo guarda en minúsculas, y el login funciona escrito como sea', async () => {
    sembrar(EMAIL_CON_MAYUSCULAS, PASSWORD);

    const { rows } = await db.queryAdmin<{ email: string }>(
      `SELECT email FROM users WHERE LOWER(email) = $1 AND role = 'super_admin'`,
      [EMAIL],
    );
    expect(rows.map((r) => r.email)).toEqual([EMAIL]);

    // La aserción que importa: con el error, las dos daban 401.
    for (const escrito of [EMAIL_CON_MAYUSCULAS, EMAIL]) {
      const res = await request(app).post('/api/auth/login').send({ email: escrito, password: PASSWORD });
      expect([escrito, res.status]).toEqual([escrito, 200]);
    }
  });

  it('arregla un superadministrador que ya quedó guardado con mayúsculas, sin duplicarlo', async () => {
    // Lo que quedó en la base de quien corrió la versión anterior.
    await db.queryAdmin(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
       VALUES (NULL, $1, 'hash-viejo', 'Super', 'Admin', 'super_admin')`,
      [EMAIL_CON_MAYUSCULAS],
    );

    const salida = sembrar(EMAIL_CON_MAYUSCULAS, PASSWORD);
    expect(salida).toMatch(/rotada/);

    const { rows } = await db.queryAdmin<{ email: string }>(
      `SELECT email FROM users WHERE LOWER(email) = $1 AND role = 'super_admin'`,
      [EMAIL],
    );
    expect(rows.map((r) => r.email)).toEqual([EMAIL]);

    const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
  });
});
