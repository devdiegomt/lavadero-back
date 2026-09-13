/**
 * Contexto de RLS para las pruebas que llaman código de la aplicación
 * directamente, sin pasar por HTTP.
 *
 * En producción esas funciones se llaman de dos formas y ninguna es "sin
 * contexto": desde una petición, donde `requireTenant` abre el contexto del
 * tenant, o desde un cron, que pide el bypass explícito. Una prueba que las
 * llama a secas no se parece a ninguno de los dos casos — y con RLS activo no ve
 * ninguna fila, porque las políticas fallan cerrado.
 *
 * Así que cada prueba declara en qué contexto corre. No es burocracia: obliga a
 * decir si la función que se está probando es de un tenant o cruza varios, que es
 * exactamente la distinción que RLS viene a hacer explícita.
 */
export {
  conTenantFueraDePeticion as conTenant,
  conBypassRlsFueraDePeticion as cruzandoTenants,
} from '../../src/shared/middleware/rls';
