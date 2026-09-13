import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas del panel en un navegador de verdad.
 *
 * Existen por dos razones, y la segunda es la que las hizo urgentes:
 *
 * 1. **RNF-COM-3** decía *"el panel funciona en navegadores actuales y en móvil
 *    — no probado sistemáticamente"*.
 * 2. **La sesión en cookie `httpOnly` no se puede probar sin un navegador.**
 *    `supertest` copia cabeceras: no aplica `HttpOnly`, ni `SameSite`, ni
 *    `Path`, ni decide si una petición cross-origin lleva la cookie. Todo eso
 *    lo decide el navegador, y hasta acá nadie se lo había preguntado.
 *
 * ## Hace falta el backend corriendo
 *
 * Vite lo levanta Playwright; el backend no, porque vive en otro repositorio y
 * necesita su base. Las pruebas fallan con un mensaje que lo dice en vez de
 * quedarse en un timeout sin explicación.
 *
 *     cd ../lavadero-back && npm run dev
 *     npx playwright test
 *
 * ## Por qué cross-origin
 *
 * `VITE_API_URL` apunta directo a `:3000` en vez de usar el proxy de Vite. Con
 * el proxy todo queda en el mismo origen y la petición ni siquiera es
 * cross-origin. Apuntando al puerto del backend el navegador ve **dos
 * orígenes**, así que hay preflight, `Access-Control-Allow-Credentials` y
 * `credentials: 'include'` de verdad —que es donde se rompe el flujo si falta.
 *
 * Lo que esto **no** prueba: `localhost:5173` y `localhost:3000` son el mismo
 * *site* (el puerto no cuenta), así que `SameSite=Lax` acá no estorba. En
 * producción el panel y la API sí están en sitios distintos (Vercel / Railway)
 * y esa cookie no viajaría: hace falta `AUTH_COOKIE_SAMESITE=none` con
 * `Secure`. Eso no lo puede comprobar esta suite —haría falta desplegar en dos
 * dominios— y queda anotado en docs/05-seguridad.md.
 *
 * ## Chromium
 *
 * `CHROMIUM_PATH` fuerza el binario. Sirve donde ya hay un Chromium instalado
 * y no se puede descargar el que Playwright pide (CI sin salida a internet).
 * En una máquina normal no hace falta: `npx playwright install chromium`.
 */
const chromium = process.env.CHROMIUM_PATH;
const launchOptions = chromium
  ? { executablePath: chromium, args: ['--no-sandbox'] }
  : {};

export default defineConfig({
  testDir: './e2e',
  // Una a la vez: comparten la misma base de datos y el mismo usuario.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'list' : [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    launchOptions,
  },

  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
    // Un móvil de verdad, no una ventana angosta: cambia el user agent, el
    // viewport y los eventos táctiles.
    { name: 'móvil', use: { ...devices['Pixel 5'] } },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      // Directo al backend, sin el proxy de Vite: ver arriba.
      VITE_API_URL: 'http://localhost:3000/api',
    },
  },
});
