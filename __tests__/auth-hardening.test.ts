/**
 * Endurecimiento de autenticación.
 *
 * Cubre tres cambios que salieron de la auditoría de seguridad:
 * el costo de bcrypt, la validación en el cambio de contraseña, y que el
 * límite de intentos de login use la configuración en vez de un valor fijo.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/index';
import * as db from '../src/shared/db';
import { config } from '../src/config';
import {
  BCRYPT_ROUNDS,
  hashPassword,
  verifyPassword,
  necesitaRehash,
} from '../src/shared/utils/password';

afterAll(async () => {
  await db.pool.end();
});

describe('costo de bcrypt', () => {
  it('usa al menos 12 rondas', () => {
    // 12 es la recomendación de OWASP. Estaba en 10, escrito a mano en
    // cinco lugares distintos.
    expect(BCRYPT_ROUNDS).toBeGreaterThanOrEqual(12);
  });

  it('el hash generado lleva el costo configurado', async () => {
    const hash = await hashPassword('una-contraseña-cualquiera');
    // Formato: $2a$<costo>$<sal+hash>
    expect(hash.split('$')[2]).toBe(String(BCRYPT_ROUNDS).padStart(2, '0'));
  });

  it('los hashes viejos de 10 rondas siguen validando', async () => {
    // Subir el costo no invalida lo existente: bcrypt lo guarda en el hash.
    const viejo = await bcrypt.hash('secreta', 10);
    expect(await verifyPassword('secreta', viejo)).toBe(true);
    expect(await verifyPassword('otra', viejo)).toBe(false);
  });

  it('detecta un hash con costo por debajo del actual', async () => {
    const viejo = await bcrypt.hash('secreta', 10);
    const nuevo = await hashPassword('secreta');
    expect(necesitaRehash(viejo)).toBe(true);
    expect(necesitaRehash(nuevo)).toBe(false);
  });

  it('un hash con formato inesperado no rompe la comprobación', () => {
    expect(necesitaRehash('esto-no-es-un-hash')).toBe(false);
    expect(necesitaRehash('')).toBe(false);
  });

  it('no queda ningún bcrypt.hash suelto en el código', () => {
    // El costo estaba repetido en cinco archivos; subirlo implicaba
    // encontrarlos todos. Este test evita que vuelva a dispersarse.
    const { execSync } = require('child_process');
    const salida = execSync(
      "grep -rn 'bcrypt.hash' src/ --include=*.ts | grep -v 'utils/password.ts' || true",
      { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' },
    ).trim();
    expect(salida).toBe('');
  });
});

describe('límite de intentos de login', () => {
  it('sale de la configuración, no de un valor fijo', () => {
    // STRICT_RATE_LIMIT_MAX existía y no se usaba: configuración muerta que
    // sugería una protección inexistente.
    expect(config.STRICT_RATE_LIMIT_MAX).toBeGreaterThan(0);
    const fuente = require('fs').readFileSync(
      require('path').join(__dirname, '../src/modules/auth/auth.routes.ts'),
      'utf8',
    );
    expect(fuente).toContain('config.STRICT_RATE_LIMIT_MAX');
    expect(fuente).not.toMatch(/max:\s*\d+/);   // sin número escrito a mano
  });

  it('rechaza credenciales inválidas antes de agotar el límite', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nadie@example.com', password: 'incorrecta' });
    // 401 o 429 según cuántos intentos lleve la suite; lo que no puede pasar
    // es que una credencial inválida devuelva 200.
    expect([401, 429]).toContain(res.status);
  });
});

describe('validación al cambiar la contraseña', () => {
  // Usuario propio y descartable: cambiarle la contraseña al admin del seed
  // deja el entorno sucio para las demás suites si la corrida se interrumpe.
  const email = `pwtest-${Date.now()}@example.com`;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const admin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@elbrillante.co', password: 'admin123' });

    const creado = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .send({
        email,
        password: 'inicial123',
        firstName: 'Prueba',
        lastName: 'Password',
        role: 'operator',
      });
    userId = creado.body.user?.id ?? creado.body.id;

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'inicial123' });
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  it('rechaza una contraseña de menos de 8 caracteres', async () => {
    // El esquema changePassword exigía min(8) desde siempre, pero la ruta
    // nunca lo aplicaba: se podía poner '123'.
    const res = await request(app)
      .patch(`/api/users/${userId}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'inicial123', newPassword: '123' });

    expect(res.status).toBe(400);
  });

  it('rechaza una contraseña vacía', async () => {
    const res = await request(app)
      .patch(`/api/users/${userId}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'inicial123', newPassword: '' });

    expect(res.status).toBe(400);
  });

  it('acepta una contraseña que cumple el mínimo', async () => {
    const res = await request(app)
      .patch(`/api/users/${userId}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'inicial123', newPassword: 'cambiada456' });

    expect(res.status).toBeLessThan(400);
    // El usuario se borra en afterAll, así que no hay nada que restaurar.
  });
});
