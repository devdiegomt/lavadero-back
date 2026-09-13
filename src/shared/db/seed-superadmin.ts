/**
 * Crea —o rota la contraseña de— el usuario `super_admin` global.
 *
 *     npm run db:seed-superadmin          # local
 *     npm run db:seed-superadmin:prod     # sobre dist/
 *
 * Este usuario NO pertenece a ningún tenant y ve todos los lavaderos. Es la
 * cuenta con más poder del sistema.
 *
 * ## Por qué esto cambió
 *
 * Antes decía:
 *
 *     const password = process.env.SUPER_ADMIN_PASSWORD || 'super123!';
 *
 * Esa contraseña está escrita en el código y en los README de los dos
 * repositorios. Un despliegue al que le faltara la variable creaba, sin fallar
 * ni avisar, un superadministrador con una credencial pública sobre una API
 * accesible desde internet. Pasó: al recrear la base de producción, el seed
 * imprimió `super123!` y ese fue el usuario que quedó vivo.
 *
 * Tres cambios, y el tercero es el que importa:
 *
 * - **Sin valor por omisión.** Si falta `SUPER_ADMIN_PASSWORD`, el script se
 *   niega. Que un despliegue incompleto falle ruidosamente es mejor que quede
 *   abierto en silencio.
 * - **No se imprime la contraseña.** Quedaba en el historial de la terminal, en
 *   el log del proveedor y en cualquier captura de pantalla.
 * - **Si el usuario ya existe, le rota la contraseña.** Antes se plantaba con
 *   "ya existe" y no hacía nada, y ese era el problema de fondo: el
 *   superadministrador **no puede cambiar su propia contraseña por la API** —
 *   todas las rutas de `/api/users` exigen tenant y él no tiene—. Se creaba con
 *   una credencial conocida y no había forma de cambiarla. Ahora sí: correr esto
 *   otra vez con otra contraseña la rota.
 *
 * (Lo otro también se arregló: `PATCH /api/auth/password` sirve para cualquier
 * usuario, superadministrador incluido. Este script queda para el arranque y
 * para cuando nadie recuerda la contraseña.)
 */
import 'dotenv/config';
import { pool } from './index';
import { hashPassword } from '../utils/password';

const MINIMO = 8;

async function seedSuperAdmin(): Promise<void> {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('❌ Faltan SUPER_ADMIN_EMAIL y/o SUPER_ADMIN_PASSWORD.');
    console.error('');
    console.error('   No hay valor por omisión a propósito: el que había estaba');
    console.error('   publicado en el README, y un despliegue sin estas variables');
    console.error('   creaba un superadministrador con una credencial conocida.');
    process.exit(1);
  }

  if (password.length < MINIMO) {
    console.error(`❌ SUPER_ADMIN_PASSWORD debe tener al menos ${MINIMO} caracteres.`);
    process.exit(1);
  }

  try {
    const passwordHash = await hashPassword(password);

    const { rows: existentes } = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1 AND role = 'super_admin'",
      [email],
    );

    if (existentes.length > 0) {
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
        passwordHash,
        existentes[0].id,
      ]);
      console.log(`🔑 Contraseña del super admin rotada: ${email}`);
      console.log('   Las sesiones abiertas siguen valiendo hasta que venzan.');
      console.log('   Para cortarlas ya: POST /api/auth/logout sin cuerpo, o borrar');
      console.log('   sus filas de refresh_tokens.');
      return;
    }

    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
       VALUES (NULL, $1, $2, 'Super', 'Admin', 'super_admin')`,
      [email, passwordHash],
    );

    console.log(`✅ Super admin creado: ${email}`);
    // La contraseña no se imprime: quien corre esto ya la tiene.
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void seedSuperAdmin();
