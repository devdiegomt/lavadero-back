/**
 * Cambiar la contraseña propia, desde el navegador.
 *
 * Antes esto no se podía hacer, y punto. Lo único parecido era el editor de
 * usuarios de Configuración, que es de admins y sirve para cambiarle la
 * contraseña a *otro* — y que además oculta el botón «Editar» en la fila de uno
 * mismo. O sea que el agujero no era una interfaz que ofreciera algo roto: era
 * que **no ofrecía nada**, para nadie, ni siquiera para el superadministrador,
 * que es la cuenta que ve todos los lavaderos.
 *
 * Lo que estas pruebas fijan, además de que funcione: que **cerrar todas las
 * sesiones** sea parte del cambio y no un detalle. Es el punto de cambiar una
 * contraseña — si alguien lo hace es porque puede estar comprometida, y las
 * sesiones abiertas con la anterior valen siete días más.
 */
import { test, expect, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, API, comprobarBackend, entrar } from './ayudas';

const NUEVA = 'otra-contrasena-larga';

test.beforeAll(async ({ request }) => {
  await comprobarBackend(request);
});

/**
 * Devuelve la contraseña a la del seed, hable o no el panel.
 *
 * Si una prueba se cae a mitad, la siguiente —y la próxima corrida entera— tiene
 * que encontrar la base como estaba. Ya pasó cuatro veces en este proyecto que
 * una suite dejara estado y rompiera otras sin relación aparente.
 */
async function restaurar(page: Page): Promise<void> {
  const res = await page.request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: NUEVA },
  });
  if (!res.ok()) return; // nunca llegó a cambiarse

  const { accessToken } = (await res.json()) as { accessToken: string };
  await page.request.patch(`${API}/auth/password`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { currentPassword: NUEVA, newPassword: PASSWORD },
  });
}

test.afterEach(async ({ page }) => {
  await restaurar(page);
});

test.describe('mi cuenta', () => {
  test('hay un enlace que DICE «Mi cuenta», y lleva ahí', async ({ page }) => {
    // Esta prueba ya existía y **pasaba con la interfaz rota**. Buscaba
    // `/mi cuenta|admin/i`, y el bloque del usuario en la barra lateral tiene el
    // rol escrito debajo del nombre — o sea que su nombre accesible contenía
    // «admin» y el enlace matcheaba por ahí. La alternativa estaba puesta para
    // el layout del superadministrador y terminó tapando justamente lo que había
    // que comprobar.
    //
    // Mientras tanto, en el panel no decía «Mi cuenta» en ninguna parte: el
    // acceso era un bloque clickeable que se veía igual que antes, y en móvil un
    // círculo con la inicial. Lo encontró alguien buscándolo y no hallándolo.
    //
    // Ahora el nombre va solo y exacto: si el texto desaparece, esto se pone en
    // rojo. Una función que no se encuentra es una función que no existe.
    await entrar(page);

    const enlace = page.getByRole('link', { name: 'Mi cuenta', exact: true }).filter({ visible: true });
    await expect(enlace, 'no hay ningún enlace visible que diga «Mi cuenta»').toHaveCount(1);

    await enlace.click();

    await expect(page).toHaveURL(/\/cuenta/);
    await expect(page.locator('#actual')).toBeVisible();
  });

  test('cambia la contraseña y cierra la sesión', async ({ page }) => {
    await entrar(page);
    await page.goto('/cuenta');

    await page.fill('#actual', PASSWORD);
    await page.fill('#nueva', NUEVA);
    await page.fill('#repetida', NUEVA);
    await page.getByRole('button', { name: /cambiar contraseña/i }).click();

    await expect(page.locator('body')).toContainText(/contraseña actualizada/i);

    // Y no es sólo un cartel: la sesión se cierra sola.
    await expect(page.locator('#password')).toBeVisible({ timeout: 15_000 });

    // La nueva sirve y la vieja no.
    const conNueva = await page.request.post(`${API}/auth/login`, {
      data: { email: EMAIL, password: NUEVA },
    });
    expect(conNueva.status()).toBe(200);

    const conVieja = await page.request.post(`${API}/auth/login`, {
      data: { email: EMAIL, password: PASSWORD },
    });
    expect(conVieja.status()).toBe(401);
  });

  test('la contraseña actual equivocada no cambia nada', async ({ page }) => {
    await entrar(page);
    await page.goto('/cuenta');

    await page.fill('#actual', 'esta-no-es-la-mia');
    await page.fill('#nueva', NUEVA);
    await page.fill('#repetida', NUEVA);
    await page.getByRole('button', { name: /cambiar contraseña/i }).click();

    await expect(page.locator('body')).toContainText(/incorrecta|inv[aá]lid|error/i);
    // Sigue dentro: no se cerró nada.
    await expect(page.locator('#actual')).toBeVisible();
  });

  test('si las dos nuevas no coinciden, ni sale la petición', async ({ page }) => {
    await entrar(page);
    await page.goto('/cuenta');

    let salio = false;
    page.on('request', (r) => {
      if (r.url().includes('/auth/password')) salio = true;
    });

    await page.fill('#actual', PASSWORD);
    await page.fill('#nueva', NUEVA);
    await page.fill('#repetida', 'otra-cosa-distinta');
    await page.getByRole('button', { name: /cambiar contraseña/i }).click();

    await expect(page.locator('body')).toContainText(/no coinciden/i);
    expect(salio, 'se mandó al servidor algo que ya se sabía mal').toBe(false);
  });
});
