/**
 * Una sola forma de escribir un teléfono.
 *
 * El teléfono es media identidad de un cliente: la otra es el `wa_lid`, y la
 * búsqueda que los enlaza compara `phone = $1` **como texto**. Así que
 * `3223772019` y `+573223772019` son dos personas distintas para la base,
 * aunque sean la misma.
 *
 * Pasó: un cliente cargado desde el panel sin el prefijo quedó duplicado la
 * primera vez que escribió por WhatsApp, porque bot-wa siempre manda
 * `+57...`. Dos filas, el historial partido en dos, y `visit_count` contando la
 * mitad en cada una.
 *
 * La forma canónica es **E.164**: `+` y dígitos, sin espacios ni guiones. Es la
 * que ya produce bot-wa desde el JID de WhatsApp, así que el resto del sistema
 * se alinea con ella en vez de inventar una propia.
 *
 * ## Lo que no hace
 *
 * **No adivina el país cuando no hay con qué.** Un número de siete dígitos es
 * un fijo del formato viejo (antes de 2022, sin indicativo de área): ponerle
 * `+57` delante produciría un teléfono que no existe, y un dato inventado es
 * peor que uno mal escrito — el segundo se ve, el primero no. En esos casos
 * devuelve el valor limpio y se queda quieto.
 */

/** Indicativo por defecto. Colombia; el proyecto no opera fuera todavía. */
const PAIS = '57';

/**
 * Lleva un teléfono a E.164 cuando se puede determinar sin suponer.
 *
 * @returns el número canónico, el valor limpio si no hay forma de
 *   canonizarlo, o `null` si no queda ningún dígito.
 */
export function normalizarTelefono(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;

  // Separadores de todos los sabores, incluido el espacio duro que se cuela al
  // copiar y pegar desde un navegador.
  const limpio = valor.replace(/[\s .\-()]/g, '').trim();
  if (limpio === '') return null;

  // 00 es el prefijo internacional de la vieja escuela: 0057… es +57…
  const conMas = limpio.startsWith('00') ? '+' + limpio.slice(2) : limpio;

  const masAlFrente = conMas.startsWith('+');
  const digitos = conMas.replace(/\D/g, '');
  if (digitos === '') return null;

  // Ya venía con indicativo explícito: se respeta tal cual, incluso de otro
  // país. Validar el plan de numeración de cada país no es de este archivo.
  if (masAlFrente) return '+' + digitos;

  // Con indicativo pero sin el +. Un fijo o un celular colombiano de diez
  // dígitos nunca empieza por 57, así que no hay ambigüedad.
  if (digitos.length === 12 && digitos.startsWith(PAIS)) return '+' + digitos;

  // Nacional de diez dígitos: celular (3XX…) o fijo del formato nuevo (60X…).
  if (digitos.length === 10 && (digitos.startsWith('3') || digitos.startsWith('60'))) {
    return `+${PAIS}${digitos}`;
  }

  // Cualquier otra cosa —un fijo viejo de siete dígitos, una extensión, algo
  // mal escrito— se devuelve limpio pero sin prefijo inventado.
  return conMas;
}

/** ¿Quedó en forma canónica, o sólo limpio? Para avisar, no para rechazar. */
export function esCanonico(telefono: string | null): boolean {
  return telefono !== null && /^\+\d{10,15}$/.test(telefono);
}

/**
 * Columnas que guardan un teléfono.
 *
 * Varias rutas actualizan por lista de campos permitidos (`ALLOWED_FIELDS`,
 * `UPDATABLE_FIELDS`, `fieldMap`) y no pasan por Zod. Que cada una se acuerde
 * de canonizar por su cuenta es el modo de fallo que ya se dio: el PATCH del
 * tenant quedó sin canonizar en el primer intento de este arreglo.
 */
export const CAMPOS_TELEFONO: ReadonlySet<string> = new Set(['phone', 'whatsapp_phone']);

/**
 * Para los bucles que arman un UPDATE campo por campo: canoniza si el campo es
 * un teléfono y devuelve el resto tal cual.
 */
export function valorDeCampo(campo: string, valor: unknown): unknown {
  return CAMPOS_TELEFONO.has(campo) ? normalizarTelefono(valor) : valor;
}
