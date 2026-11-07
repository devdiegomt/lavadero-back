/**
 * La página pública de reservas, de punta a punta: el cliente reserva sin
 * sesión y el turno aparece en la agenda del panel.
 */
import { test, expect } from '@playwright/test';
import { comprobarBackend, entrar } from './ayudas';

// Un número por corrida: el backend limita las reservas pendientes por teléfono.
const telefono = () => `311${String(Date.now()).slice(-7)}`;
const placa = () => `RSV${String(Date.now()).slice(-3)}`;

test.describe('con el backend', () => {
  test.beforeAll(async ({ request }) => {
    await comprobarBackend(request);
  });

  test('un cliente reserva sin iniciar sesión y la ve confirmada', async ({ page }) => {
    await page.goto('/reservar/el-brillante');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lavadero El Brillante');
    await expect(page.locator('#password')).toHaveCount(0); // no manda al login

    await page.getByRole('radio', { name: 'Automóvil' }).click();
    await page.getByRole('radio', { name: /Lavado Completo/ }).click();
    await expect(page.getByRole('radio', { name: /Lavado Completo/ })).toContainText('$40.000');

    // El primer día con cupo queda elegido; se toma la última hora para no
    // chocar con lo que dejen otras pruebas.
    const horas = page.getByRole('radiogroup', { name: 'Hora' }).getByRole('radio');
    await expect(horas.first()).toBeVisible();
    await horas.last().click();

    const p = placa();
    await page.locator('#nombre').fill('Prueba Reserva');
    await page.locator('#telefono').fill(telefono());
    await page.locator('#placa').fill(p);

    // Sin la autorización no reserva.
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByRole('alert')).toContainText('autorizar');

    await expect(page.getByRole('link', { name: 'Ver aviso de privacidad' })).toHaveAttribute('href', '/privacidad/el-brillante');
    await page.locator('#autoriza').check();
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('¡Listo, quedó reservado!');
    await expect(page.locator('dl')).toContainText(p);
    await expect(page.locator('dl')).toContainText('Lavado Completo');
  });

  test('un servicio sin precio para ese tipo de vehículo no se puede elegir', async ({ page }) => {
    await page.goto('/reservar/el-brillante');
    await page.getByRole('radio', { name: 'Moto' }).click();
    await expect(page.getByRole('radio', { name: /Solo Aspirado/ })).toBeDisabled();
  });

  test('un lavadero que no existe lo dice', async ({ page }) => {
    await page.goto('/reservar/no-existe-este-lavadero');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('No encontramos este lavadero');
  });

  test('el dueño encuentra el enlace en Configuración', async ({ page }) => {
    await entrar(page);
    await page.goto('/settings');
    await expect(page.getByTestId('enlace-reservas')).toHaveText(/\/reservar\/el-brillante$/);
  });
});
