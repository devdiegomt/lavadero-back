/**
 * Lo que comparten las pruebas de navegador: entrar al panel y comprobar que
 * hay un backend con el que hablar.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const EMAIL = 'admin@elbrillante.co';
export const PASSWORD = 'admin123';
export const API = 'http://localhost:3000/api';

/** El ancho a partir del cual Tailwind considera "escritorio" (`lg:`). */
export const ANCHO_ESCRITORIO = 1024;

export const COMO_LEVANTARLO =
  '  cd ../lavadero-back\n' +
  '  npm run db:reset\n' +
  '  NODE_ENV=development RATE_LIMIT_MAX=100000 STRICT_RATE_LIMIT_MAX=100 npm run dev';

/**
 * Sin backend, todo lo demás falla en un timeout que no explica nada.
 *
 * Y con el backend arriba pero con los límites de siempre pasa algo peor: las
 * primeras pruebas pasan y las siguientes fallan como si el login estuviera
 * roto. No lo está — es `STRICT_RATE_LIMIT_MAX`, que por defecto son cinco
 * intentos fallidos por email cada quince minutos, y la prueba de la contraseña
 * equivocada gasta uno por corrida y por proyecto. Por eso el login de prueba:
 * gastar un segundo en decirlo vale más que perseguir un fantasma.
 */
export async function comprobarBackend(request: APIRequestContext): Promise<void> {
  let salud = 0;
  try {
    salud = (await request.get(`${API}/health`)).status();
  } catch {
    salud = 0;
  }
  expect(salud, `El backend no responde en ${API}. Levantarlo antes:\n${COMO_LEVANTARLO}`).toBe(
    200,
  );

  // Un login que funciona no cuenta para el límite (`skipSuccessfulRequests`),
  // así que esta comprobación es gratis.
  const login = await request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(login.status(), explicar(login.status())).toBe(200);
}

/**
 * Qué decir según el código, porque no todos significan lo mismo.
 *
 * El mensaje era uno solo —«¿falta `npm run db:reset`?»— y con un **500** eso
 * manda por el camino equivocado: el 500 no aparece cuando falta el seed, sino
 * cuando el backend arrancó bien y se rompió después. Pasó en CI: seis pruebas
 * repitiendo esa pregunta mientras la causa real era que el servidor se había
 * caído a mitad de la corrida.
 *
 * Un mensaje de error que apunta al lugar equivocado cuesta más que no tener
 * mensaje.
 */
function explicar(codigo: number): string {
  if (codigo === 429) {
    return (
      'El backend está limitando los intentos de login. Reiniciarlo con el ' +
      `límite alto —o esperar quince minutos:\n${COMO_LEVANTARLO}`
    );
  }

  if (codigo === 401) {
    return (
      'El backend responde pero el usuario de prueba no existe o tiene otra ' +
      `contraseña. Eso sí es el seed:\n${COMO_LEVANTARLO}`
    );
  }

  if (codigo >= 500) {
    return (
      `El backend contestó ${codigo} al login. **Arrancó bien y se rompió ` +
      'después** — el seed no tiene nada que ver. Mirar su log: un ' +
      '`pool.connect()` agotado, la base caída y el proceso muerto se ven ' +
      'distinto. En CI está en el paso «Qué le pasó al backend» y en el ' +
      'artefacto `backend-log`.'
    );
  }

  return `El login de prueba devolvió HTTP ${codigo}, que no se esperaba.`;
}

export async function entrar(page: Page): Promise<void> {
  await page.goto('/');
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');
  // La señal de que entró: el login desaparece.
  await expect(page.locator('#password')).toHaveCount(0, { timeout: 15_000 });
}
