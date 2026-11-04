/**
 * La marca de Qlarity: una Q cuya cola es una gota que se desprende.
 *
 * Es el mismo dibujo que `public/favicon.svg`, sin el fondo y en
 * `currentColor`, para que tome el latón del modo en que esté el panel: más
 * claro sobre grafito, más oscuro en el modo día.
 */
export default function MarcaQ({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="17 16 72 72"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="45" cy="44" r="23" fill="none" stroke="currentColor" strokeWidth="10" />
      <path
        transform="translate(74.5 73.5) rotate(-45)"
        d="M0 -17 C 5 -9 9 -3 9 3 A 9 9 0 1 1 -9 3 C -9 -3 -5 -9 0 -17 Z"
        fill="currentColor"
      />
    </svg>
  );
}
