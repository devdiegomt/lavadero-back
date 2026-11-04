/**
 * El panel sigue el modo claro u oscuro del teléfono, sin botón.
 *
 * Lo que se comprueba es lo que ve la persona: el color del fondo y del botón
 * principal, no que exista una regla en el CSS. Y que cambie **en vivo**:
 * muchos teléfonos pasan a oscuro al atardecer, con el panel abierto.
 *
 * Se mira el login a propósito: no necesita backend, y usa los mismos
 * colores que el resto del panel.
 */
import { test, expect, type Page } from '@playwright/test';

const FONDO_OSCURO = 'rgb(23, 25, 27)'; // grafito
const FONDO_CLARO = 'rgb(242, 241, 238)';
const LATON_OSCURO = 'rgb(200, 167, 102)';
const LATON_CLARO = 'rgb(138, 106, 44)'; // más oscuro, para leerse sobre blanco

async function colores(page: Page) {
  return page.evaluate(() => {
    const boton = document.querySelector('button[type="submit"]') as HTMLElement;
    return {
      fondo: getComputedStyle(document.body).backgroundColor,
      boton: getComputedStyle(boton).backgroundColor,
      textoBoton: getComputedStyle(boton).color,
    };
  });
}

test.describe('con el teléfono en oscuro', () => {
  test.use({ colorScheme: 'dark' });

  test('el panel es grafito', async ({ page }) => {
    await page.goto('/login');
    const c = await colores(page);
    expect(c.fondo).toBe(FONDO_OSCURO);
    expect(c.boton).toBe(LATON_OSCURO);
  });
});

test.describe('con el teléfono en claro', () => {
  test.use({ colorScheme: 'light' });

  test('el panel es Grafito día', async ({ page }) => {
    await page.goto('/login');
    const c = await colores(page);
    expect(c.fondo).toBe(FONDO_CLARO);
    expect(c.boton).toBe(LATON_CLARO);
    // Texto blanco sobre el latón oscurecido: 5:1 de contraste.
    expect(c.textoBoton).toBe('rgb(255, 255, 255)');
  });

  test('cambia solo si el teléfono cambia de modo, sin recargar', async ({ page }) => {
    await page.goto('/login');
    expect((await colores(page)).fondo).toBe(FONDO_CLARO);

    await page.emulateMedia({ colorScheme: 'dark' });
    expect((await colores(page)).fondo).toBe(FONDO_OSCURO);

    await page.emulateMedia({ colorScheme: 'light' });
    expect((await colores(page)).fondo).toBe(FONDO_CLARO);
  });
});
