/**
 * La casilla con la que se da una autorización de datos (Ley 1581).
 *
 * Es expresa —hay que marcarla, nunca viene marcada— e informada: enlaza al
 * texto que se está aceptando, que abre en otra pestaña para no perder lo que
 * ya se llenó en el formulario.
 */
import type { ReactNode } from 'react';

export default function CasillaAutorizacion({
  id,
  marcada,
  onCambio,
  enlace,
  textoEnlace,
  children,
}: {
  id: string;
  marcada: boolean;
  onCambio(v: boolean): void;
  enlace: string;
  textoEnlace: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <input
        id={id}
        type="checkbox"
        checked={marcada}
        onChange={(e) => onCambio(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0"
      />
      <label htmlFor={id} className="text-sm text-gray-700 leading-snug">
        {children}{' '}
        <a href={enlace} target="_blank" rel="noopener" className="text-brand-700 font-semibold underline underline-offset-2">
          {textoEnlace}
        </a>
      </label>
    </div>
  );
}
