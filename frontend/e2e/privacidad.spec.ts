/**
 * Privacidad: las dos páginas públicas y la autorización al crear clientes.
 *
 * Hasta acá un operario podía crear un cliente desde el panel sin que quedara
 * ninguna autorización registrada, que es lo primero que pide la Ley 1581.
 */
import { test, expect } from '@playwright/test';
import { comprobarBackend, entrar } from './ayudas';

test('la política de Qlarity se lee sin iniciar sesión', async ({ page }) => {
  await page.goto('/privacidad');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Política de tratamiento de datos personales/);
  await expect(page.getByRole('heading', { name: /Con quién se comparten/ })).toBeVisible();
  await expect(page.locator('#password')).toHaveCount(0); // no manda al login
});

test.describe('con el backend', () => {
  test.beforeAll(async ({ request }) => {
    await comprobarBackend(request);
  });

  test('el aviso de un lavadero muestra quién es el responsable', async ({ page }) => {
    await page.goto('/privacidad/el-brillante');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aviso de privacidad de Lavadero El Brillante');
    await expect(page.locator('article')).toContainText('900123456-7'); // su NIT
    await expect(page.getByRole('link', { name: /política de tratamiento de datos de Qlarity/ })).toHaveAttribute('href', '/privacidad');
  });

  test('un lavadero que no existe lo dice, no se queda cargando', async ({ page }) => {
    await page.goto('/privacidad/no-existe-este-lavadero');
    await expect(page.locator('article')).toContainText('No encontramos este lavadero');
  });

  test('crear un cliente pide la autorización, y no deja crearlo sin ella', async ({ page }) => {
    await entrar(page);
    await page.goto('/customers');
    await page.getByRole('button', { name: /nuevo cliente|agregar|crear/i }).first().click();

    const crear = page.getByRole('button', { name: 'Crear cliente' });
    await expect(crear).toBeDisabled();

    const casilla = page.getByLabel(/autoriza que se guarden sus datos/);
    await expect(page.getByRole('link', { name: 'Ver el aviso' })).toHaveAttribute('href', '/privacidad/el-brillante');
    await casilla.check();
    await expect(crear).toBeEnabled();
  });
});
