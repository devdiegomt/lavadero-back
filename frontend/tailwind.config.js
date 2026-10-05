/**
 * Grafito latón: el panel es oscuro, con latón como único acento.
 *
 * Los colores no viven acá sino en `src/index.css`, como variables. Cada
 * escala de Tailwind (`gray`, `brand`, `green`…) apunta a su variable, así que
 * las clases que ya usaba el panel siguen funcionando y cambian de aspecto sin
 * tocarlas una por una.
 *
 * Las escalas están **invertidas**: `gray-50` es el fondo más oscuro y
 * `gray-900` el texto más claro. Así cada clase conserva su función —
 * `bg-gray-50` sigue siendo «fondo», `text-gray-900` sigue siendo «texto
 * principal», `bg-green-50 text-green-700` sigue siendo «insignia verde»— y
 * sólo cambia el color. `white` es la superficie de las tarjetas, por eso
 * `text-white` sobre un botón de latón da texto oscuro.
 *
 * Un modo claro, si se decide hacerlo, es otro bloque de variables en
 * `index.css`: no hace falta tocar ningún componente.
 */
const escala = (nombre) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [
      n,
      `rgb(var(--${nombre}-${n}, var(--${nombre}-900)) / <alpha-value>)`,
    ]),
  );

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        white: 'rgb(var(--white) / <alpha-value>)',
        // La barra lateral y las de arriba y abajo: un punto más oscura que el fondo.
        lateral: 'rgb(var(--lateral) / <alpha-value>)',
        black: 'rgb(var(--black) / <alpha-value>)',
        gray: escala('gray'),
        brand: escala('brand'),
        green: escala('green'),
        emerald: escala('emerald'),
        red: escala('red'),
        blue: escala('blue'),
        yellow: escala('yellow'),
        orange: escala('orange'),
        purple: escala('purple'),
      },
      fontFamily: {
        sans: ['"Archivo Variable"', 'Archivo', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      borderRadius: {
        // Más rectos que los de Tailwind: el redondeado grande es lo que hacía
        // que el panel se viera infantil.
        lg: '0.25rem',
        xl: '0.375rem',
        '2xl': '0.5rem',
      },
    },
  },
  plugins: [],
};
