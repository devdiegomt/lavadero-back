/**
 * RNF-COM-3: *"el panel funciona en navegadores actuales y en móvil"*.
 *
 * Estaba marcado como **no probado sistemáticamente**, y lo estaba: el panel se
 * había mirado en un teléfono, que no es lo mismo que comprobarlo. Estas
 * pruebas corren en los dos proyectos de `playwright.config.ts` —Desktop Chrome
 * y Pixel 5— y preguntan lo que de verdad se rompe en una pantalla angosta.
 *
 * Lo que **no** cubre: Safari y Firefox. Playwright los sabe manejar, pero sus
 * binarios no están en este contenedor. Queda anotado en docs/02-requerimientos.md.
 */
import { test, expect, type Page } from '@playwright/test';
import { ANCHO_ESCRITORIO, comprobarBackend, entrar } from './ayudas';

/** Las pantallas del panel, con el rol de admin que usa la prueba. */
const PANTALLAS = [
  { ruta: '/', nombre: 'Inicio' },
  { ruta: '/board', nombre: 'Tablero' },
  { ruta: '/appointments', nombre: 'Agenda' },
  { ruta: '/payments', nombre: 'Pagos' },
  { ruta: '/history', nombre: 'Historial' },
  { ruta: '/billing', nombre: 'Facturación' },
  { ruta: '/reports', nombre: 'Reportes' },
  { ruta: '/customers', nombre: 'Clientes' },
  { ruta: '/settings', nombre: 'Config' },
];

test.beforeAll(async ({ request }) => {
  await comprobarBackend(request);
});

/**
 * Cuánto se desborda la página a lo ancho, en píxeles.
 *
 * Cero es lo correcto. Cualquier otra cosa es la falla clásica del móvil: una
 * tabla, un `min-width` o un título largo empujan el documento y toda la
 * pantalla se puede arrastrar de lado.
 */
async function desborde(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Devuelve el elemento más ancho que el viewport, para poder nombrarlo. */
async function culpableDelDesborde(page: Page): Promise<string> {
  return page.evaluate(() => {
    const limite = document.documentElement.clientWidth;
    let peor = '';
    let peorAncho = limite;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.right > peorAncho + 1) {
        peorAncho = r.right;
        peor = `<${el.tagName.toLowerCase()} class="${el.className}"> llega a ${Math.round(r.right)}px`;
      }
    }
    return peor || '(ninguno: el desborde no viene de un elemento suelto)';
  });
}

test.describe('la página cabe a lo ancho', () => {
  // Una prueba por pantalla: si sólo falla Reportes, el informe lo dice en vez
  // de decir "el panel se desborda".
  for (const { ruta, nombre } of PANTALLAS) {
    test(`${nombre} no se desborda`, async ({ page }) => {
      await entrar(page);
      await page.goto(ruta);
      // Que haya terminado de pintar: si no, se mide una pantalla vacía y
      // cualquier cosa "cabe".
      await expect(page.locator('main')).toBeVisible();
      await page.waitForLoadState('networkidle');

      const sobra = await desborde(page);
      expect(sobra, sobra > 0 ? await culpableDelDesborde(page) : '').toBeLessThanOrEqual(0);
    });
  }
});

test.describe('la navegación que toca para cada tamaño', () => {
  test('en móvil manda la barra de abajo; en escritorio, la lateral', async ({ page }) => {
    await entrar(page);
    const ancho = page.viewportSize()!.width;
    const esMovil = ancho < ANCHO_ESCRITORIO;

    const lateral = page.locator('aside');
    const abajo = page.locator('nav').last();

    if (esMovil) {
      await expect(lateral).toBeHidden();
      await expect(abajo).toBeVisible();
    } else {
      await expect(lateral).toBeVisible();
    }
  });

  test('se puede llegar a otra pantalla con lo que se ve', async ({ page }) => {
    // No basta con que los enlaces existan: en móvil la barra de abajo sólo
    // muestra los cinco primeros, y el resto no tiene ningún otro acceso. Esta
    // prueba navega con lo que el usuario puede tocar.
    await entrar(page);

    await page
      .getByRole('link', { name: /agenda/i })
      .filter({ visible: true })
      .first()
      .click();

    await expect(page).toHaveURL(/\/appointments/);
    await expect(page.locator('main')).toBeVisible();
  });
});

test.describe('lo que se toca con el dedo', () => {
  test('los botones de la barra de abajo son lo bastante grandes', async ({ page }) => {
    const ancho = page.viewportSize()!.width;
    test.skip(ancho >= ANCHO_ESCRITORIO, 'La barra de abajo es sólo de móvil');

    await entrar(page);

    // 44px es la recomendación de Apple y la de WCAG 2.1 (2.5.5) para un
    // objetivo táctil. Por debajo de eso se falla el toque y se abre otra cosa.
    const enlaces = page.locator('nav').last().getByRole('link');
    const cuantos = await enlaces.count();
    expect(cuantos).toBeGreaterThan(0);

    for (let i = 0; i < cuantos; i++) {
      const caja = await enlaces.nth(i).boundingBox();
      const texto = (await enlaces.nth(i).innerText()).replace(/\s+/g, ' ').trim();
      expect(caja, `no se pudo medir "${texto}"`).not.toBeNull();
      expect(caja!.height, `"${texto}" mide ${Math.round(caja!.height)}px de alto`).toBeGreaterThanOrEqual(44);
      expect(caja!.width, `"${texto}" mide ${Math.round(caja!.width)}px de ancho`).toBeGreaterThanOrEqual(44);
    }
  });
});
