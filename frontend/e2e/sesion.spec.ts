/**
 * La sesión, vista por un navegador de verdad.
 *
 * El backend tiene once pruebas del flujo de cookie, pero `supertest` sólo copia
 * cabeceras: **no aplica `HttpOnly`, ni `SameSite`, ni `Path`, ni decide si una
 * petición cross-origin lleva la cookie.** Todo eso lo decide el navegador, y
 * hasta acá nadie se lo había preguntado.
 *
 * Estas pruebas comprueban lo que el cambio **afirma**, no lo que el servidor
 * manda:
 *
 * - Que el JavaScript de la página no pueda leer la cookie.
 * - Que no quede ningún token en `localStorage`.
 * - Que recargar mantenga la sesión, que es el costo de no persistir el access
 *   token y el paso que más fácil se rompe.
 */
import { test, expect } from '@playwright/test';
import { EMAIL, comprobarBackend, entrar } from './ayudas';

test.beforeAll(async ({ request }) => {
  await comprobarBackend(request);
});

test.describe('entrar y salir', () => {
  test('el login lleva al panel', async ({ page }) => {
    await entrar(page);
    await expect(page.locator('body')).toContainText(/lavadero|turno|tablero|hoy/i);
  });

  test('una contraseña equivocada no entra y lo dice', async ({ page }) => {
    await page.goto('/');
    await page.fill('#email', EMAIL);
    await page.fill('#password', 'esta-no-es');
    await page.click('button[type="submit"]');

    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('body')).toContainText(/inv[aá]lid|incorrect|error/i);
  });
});

test.describe('dónde vive la sesión', () => {
  test('el JavaScript de la página NO puede leer la cookie', async ({ page }) => {
    // El punto entero del cambio. `supertest` no puede comprobar esto: sólo un
    // navegador respeta `HttpOnly`.
    await entrar(page);

    const visibleParaJs = await page.evaluate(() => document.cookie);
    expect(visibleParaJs).not.toContain('refresh_token');

    // Y el navegador sí la tiene: no es que no exista.
    const cookies = await page.context().cookies();
    const refresh = cookies.find((c) => c.name === 'refresh_token');
    expect(refresh, 'el backend no puso la cookie de sesión').toBeDefined();
    expect(refresh!.httpOnly).toBe(true);
    expect(refresh!.path).toBe('/api/auth');
  });

  test('no queda ningún token en localStorage', async ({ page }) => {
    // Era exactamente lo que había antes, y de donde un XSS se los llevaba.
    await entrar(page);

    const guardado = await page.evaluate(() => ({
      claves: Object.keys(localStorage),
      todo: JSON.stringify(localStorage),
    }));

    expect(guardado.claves).not.toContain('accessToken');
    expect(guardado.claves).not.toContain('refreshToken');
    // Ni escondido dentro de otra clave: `user` sí se guarda, pero es dato de
    // pantalla, no una credencial.
    expect(guardado.todo).not.toMatch(/accessToken|refreshToken/);
  });
});

test.describe('recargar la página', () => {
  test('mantiene la sesión', async ({ page }) => {
    // El costo de no persistir el access token: tras recargar no hay ninguno y
    // hay que pedir uno con la cookie. Es el paso que más fácil se rompe —basta
    // con olvidar `credentials: 'include'`— y no se nota hasta que alguien
    // recarga.
    await entrar(page);
    await page.reload();

    await expect(page.locator('#password')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('body')).toContainText(/lavadero|turno|tablero|hoy/i);
  });

  test('una pantalla con varias consultas en paralelo no cierra la sesión', async ({ page }) => {
    // El backend rota el refresh token y revoca el anterior en el acto, así que
    // dos renovaciones simultáneas se pisan: la segunda llega con un token
    // muerto y el panel manda al login.
    //
    // Y simultáneas es lo normal: al abrir una pantalla el panel dispara varias
    // consultas a la vez y, recién cargado el documento, ninguna tiene access
    // token. Pasaba en Pagos y en Config —no en Inicio— así que sin abrir esas
    // pantallas no se veía. La cura es renovar de a una (`api.ts`).
    await entrar(page);

    for (const ruta of ['/payments', '/settings']) {
      await page.goto(ruta);
      await expect(page.locator('#password'), `${ruta} cerró la sesión`).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(page.locator('main')).toBeVisible();
    }
  });

  test('otra pestaña no renueva mientras esta está renovando', async ({ page, context }) => {
    // Dos pestañas comparten la cookie pero no las variables del módulo, así que
    // la cura de la prueba anterior —renovar de a una— no las alcanza: cada una
    // tiene su propia "de a una". Las dos llegan con el mismo refresh token, una
    // lo revoca y la otra se queda sin nada. Reproducido recargando dos juntas:
    // tres de cada cuatro intentos dejaban alguna en el login, y uno dejó a las
    // dos. Lo cierra un candado de `navigator.locks`, que es del origen.
    //
    // **Por qué esta prueba tiene esta forma.** Recargar dos pestañas a la vez y
    // ver si alguna pierde la sesión no sirve como prueba: la ventana de la
    // carrera dura lo que tarda el refresh, y contra la base local son 2 ms, así
    // que lo atrapaba 1 de cada 8 veces. Ensancharla con un retraso tampoco —
    // cualquier interceptor de Playwright serializa las peticiones y termina
    // implementando el candado sin querer, con lo cual la prueba pasaba incluso
    // con el arreglo desactivado.
    //
    // Así que se comprueba el mecanismo, que es lo que de verdad da la garantía:
    // con el candado tomado, la otra pestaña **no puede** pedir un refresh. Sale
    // determinista — 1.500 ms con el arreglo, 90 ms sin él.
    await entrar(page);

    // Si no hubiera `navigator.locks` el panel renovaría sin candado y esta
    // prueba mediría otra cosa. Requiere contexto seguro: `localhost` lo es.
    expect(
      await page.evaluate(() => typeof navigator.locks),
      'sin navigator.locks el panel no puede coordinar pestañas',
    ).toBe('object');

    const otra = await context.newPage();
    await otra.goto('/');
    await expect(otra.locator('#password')).toHaveCount(0, { timeout: 15_000 });

    // Esta pestaña toma el candado y lo sostiene, como si estuviera renovando.
    const SOSTENIDO_MS = 1500;
    await page.evaluate((ms) => {
      void navigator.locks.request(
        'carwash:refresh',
        () => new Promise<void>((suelta) => setTimeout(suelta, ms)),
      );
    }, SOSTENIDO_MS);

    const t0 = Date.now();
    const pedido = otra.waitForRequest((r) => r.url().includes('/auth/refresh'), {
      timeout: 10_000,
    });
    void otra.goto('/payments');
    await pedido;
    const cuando = Date.now() - t0;

    expect(
      cuando,
      `la otra pestaña pidió el refresh a los ${cuando} ms: no esperó el candado`,
    ).toBeGreaterThan(SOSTENIDO_MS * 0.8);

    // Y después de esperar, entra: el candado retrasa, no rompe.
    await expect(otra.locator('#password')).toHaveCount(0, { timeout: 15_000 });
  });

  test('sin cookie, recargar lleva al login', async ({ page }) => {
    await entrar(page);
    await page.context().clearCookies();
    await page.reload();

    await expect(page.locator('#password')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('cerrar sesión', () => {
  test('borra la cookie del navegador', async ({ page }) => {
    // Cerrar sesión dejó de ser una limpieza local: sólo el servidor puede
    // borrar una cookie httpOnly. Si la petición no saliera bien, la cookie
    // quedaría y la sesión se podría reanudar.
    await entrar(page);

    // El panel tiene dos botones de salir y sólo uno se ve a la vez: el 🚪 de
    // la barra lateral y el "Salir" del encabezado móvil. El otro sigue en el
    // DOM, oculto por CSS, así que filtrar por visible es lo correcto: se hace
    // clic en el que el usuario ve.
    //
    // Buscar por rol y nombre, no por texto: el 🚪 no tenía nombre accesible
    // —un lector de pantalla anunciaba «puerta»— y esta prueba fue la que lo
    // hizo evidente. Ahora lleva `aria-label`.
    await page
      .getByRole('button', { name: /salir|cerrar sesi[oó]n/i })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page.locator('#password')).toBeVisible({ timeout: 15_000 });

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'refresh_token' && c.value !== '')).toBeUndefined();
  });
});
