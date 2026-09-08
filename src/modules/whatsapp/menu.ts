/**
 * Interpretación de una respuesta a un menú numerado.
 *
 * Los menús del bot piden un número, pero la gente escribe lo que ve. En una
 * prueba real el cliente respondió «Sedan» a «1️⃣ Sedán / Auto» y el bot le
 * contestó «Escribe un número del 1 al 4» — que es correcto y a la vez una
 * mala respuesta: el cliente había entendido perfectamente y había contestado
 * bien.
 *
 * Esto no es adivinar la intención: es aceptar la palabra que el propio menú
 * acaba de mostrar. Sigue habiendo un número; se admite además el texto.
 *
 * **El número manda.** Si lo que llega parece un índice válido, se usa ese y no
 * se intenta ninguna coincidencia por texto. Evita que un menú con una opción
 * llamada «2 manos» convierta un «2» en otra cosa.
 */

/** Quita tildes, mayúsculas y espacios de más. */
export function normalizar(texto: string): string {
  return String(texto ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // marcas diacriticas: a con tilde -> a
    .replace(/\s+/g, ' ');
}

/** Una opción del menú: su posición y las palabras que la identifican. */
export interface OpcionMenu {
  /** Palabras aceptadas. La primera suele ser la que se le mostró al cliente. */
  claves: string[];
}

/**
 * Devuelve el índice (base 0) de la opción elegida, o `null` si no se entiende.
 *
 * Acepta, en este orden:
 *
 * 1. El número de la opción — `2`
 * 2. El texto exacto de alguna clave — `SUV`, `suv`, `Sedán`
 * 3. Una clave contenida en lo que escribió — `quiero el lavado basico`
 *
 * El paso 3 exige que la clave tenga al menos 4 caracteres: sin eso, una clave
 * como «uno» aparecería dentro de «ninguno» y elegiría por el cliente.
 */
export function elegirOpcion(texto: string, opciones: OpcionMenu[]): number | null {
  const t = normalizar(texto);
  if (!t || opciones.length === 0) return null;

  // 1. Número puro. Precede a todo lo demás.
  if (/^\d+$/.test(t)) {
    const idx = parseInt(t, 10) - 1;
    return idx >= 0 && idx < opciones.length ? idx : null;
  }

  const claves = opciones.map((o) => o.claves.map(normalizar));

  // 2. Coincidencia exacta.
  for (let i = 0; i < claves.length; i++) {
    if (claves[i].includes(t)) return i;
  }

  // 3. La clave aparece dentro de la frase. Sólo claves largas, y sólo si una
  //    única opción coincide: con dos, no hay forma de saber cuál quiso.
  const candidatos: number[] = [];
  for (let i = 0; i < claves.length; i++) {
    if (claves[i].some((c) => c.length >= 4 && t.includes(c))) candidatos.push(i);
  }
  return candidatos.length === 1 ? candidatos[0] : null;
}

/**
 * Tipos de vehículo, en el mismo orden que el menú que ve el cliente.
 *
 * Las palabras salen de cómo habla la gente en Colombia, no del esquema de la
 * base: nadie escribe «sedan» cuando puede escribir «carro».
 */
export const TIPOS_VEHICULO: { tipo: string; claves: string[] }[] = [
  { tipo: 'sedan', claves: ['sedan', 'auto', 'carro', 'automovil', 'sedan / auto'] },
  { tipo: 'suv', claves: ['suv', 'camioneta', 'suv / camioneta'] },
  { tipo: 'pickup', claves: ['pickup', 'pick up', 'platon'] },
  { tipo: 'moto', claves: ['moto', 'motocicleta', 'motico'] },
];

/** Interpreta la respuesta al menú de tipo de vehículo. `null` si no se entiende. */
export function elegirTipoVehiculo(texto: string): string | null {
  const idx = elegirOpcion(texto, TIPOS_VEHICULO);
  return idx === null ? null : TIPOS_VEHICULO[idx].tipo;
}
