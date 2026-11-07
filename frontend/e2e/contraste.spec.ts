/**
 * Que todo el texto visible se pueda leer, en modo oscuro y en modo día.
 *
 * Sale de un caso real: en el registro, «¿Ya tienes cuenta? Inicia sesión»
 * quedó casi invisible. Usaba `text-white`, que en el diseño anterior era
 * blanco sobre un degradado azul y en Grafito latón es el color de las
 * tarjetas: gris oscuro sobre gris oscuro. Nadie lo vio hasta abrir la
 * página. Esta prueba mide el contraste de cada texto contra su fondo real
 * (WCAG AA: 4,5:1, o 3:1 para texto grande), así el siguiente no depende de
 * que alguien lo note.
 */
import { test, expect, type Page } from '@playwright/test';
import { comprobarBackend, entrar } from './ayudas';

interface Falla {
  texto: string;
  ratio: number;
  minimo: number;
  color: string;
  fondo: string;
}

async function fallasDeContraste(page: Page): Promise<Falla[]> {
  return page.evaluate(() => {
    const rgb = (c: string): [number, number, number, number] => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fondoDe = (el: Element | null): [number, number, number] => {
      for (let n = el; n; n = n.parentElement) {
        const [r, g, b, a] = rgb(getComputedStyle(n).backgroundColor);
        if (a > 0.5) return [r, g, b];
      }
      return [255, 255, 255];
    };
    const fallas: Falla[] = [];
    const vistos = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const nodo = walker.currentNode as Text;
      const texto = nodo.data.trim();
      const el = nodo.parentElement;
      if (!texto || !el || el.closest('[aria-hidden="true"], [disabled], option, script, style')) continue;
      const cs = getComputedStyle(el);
      const caja = el.getBoundingClientRect();
      if (cs.visibility === 'hidden' || cs.display === 'none' || caja.width === 0 || caja.height === 0) continue;
      // Algo semitransparente por arriba (estados deshabilitados): WCAG no lo exige.
      let opaco = true;
      for (let n: Element | null = el; n; n = n.parentElement) if (Number(getComputedStyle(n).opacity) < 1) opaco = false;
      if (!opaco) continue;
      const [r, g, b] = rgb(cs.color);
      const fondo = fondoDe(el);
      const [l1, l2] = [lum([r, g, b]), lum(fondo)].sort((x, y) => y - x);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      const px = parseFloat(cs.fontSize);
      const grande = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
      const minimo = grande ? 3 : 4.5;
      const clave = `${texto}|${cs.color}`;
      if (ratio < minimo && !vistos.has(clave)) {
        vistos.add(clave);
        fallas.push({ texto: texto.slice(0, 50), ratio: Math.round(ratio * 100) / 100, minimo, color: cs.color, fondo: `rgb(${fondo.join(', ')})` });
      }
    }
    return fallas;
  });
}

for (const esquema of ['dark', 'light'] as const) {
  test.describe(`contraste en modo ${esquema === 'dark' ? 'oscuro' : 'día'}`, () => {
    test.use({ colorScheme: esquema });

    test('el login y el registro se leen', async ({ page }) => {
      for (const ruta of ['/login', '/signup', '/privacidad', '/privacidad/el-brillante']) {
        await page.goto(ruta);
        await page.waitForLoadState('networkidle');
        expect(await fallasDeContraste(page), ruta).toEqual([]);
      }
    });

    test('la página de reservas se lee, con todo desplegado', async ({ page, request }) => {
      await comprobarBackend(request);
      await page.goto('/reservar/el-brillante');
      await page.getByRole('radio', { name: 'Moto' }).click(); // deja un servicio deshabilitado a la vista
      await page.getByRole('radio', { name: /Lavado Completo/ }).click();
      await page.getByRole('radiogroup', { name: 'Hora' }).getByRole('radio').first().click();
      await page.getByRole('button', { name: 'Confirmar reserva' }).click(); // el aviso de error
      await page.waitForLoadState('networkidle');
      expect(await fallasDeContraste(page), '/reservar').toEqual([]);
    });

    test('las pantallas del panel se leen', async ({ page, request }) => {
      await comprobarBackend(request);
      await entrar(page);
      const rutas = [
        '/', '/board', '/appointments', '/payments', '/history', '/billing', '/reports', '/customers',
        '/settings', '/settings?tab=services', '/settings?tab=team', '/settings?tab=plan', '/cuenta',
      ];
      for (const ruta of rutas) {
        await page.goto(ruta);
        await page.waitForLoadState('networkidle');
        expect(await fallasDeContraste(page), ruta).toEqual([]);
      }
    });
  });
}
