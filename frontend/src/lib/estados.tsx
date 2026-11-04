/**
 * Los estados de un turno, en un solo lugar.
 *
 * Estaban definidos cuatro veces —Tablero, Agenda, Historial y el buscador de
 * placas— con colores que no coincidían: «Entregado» era azul en unos y en
 * otros no aparecía. Ahora los cuatro leen de acá.
 *
 * **El estado se ve por la forma, no sólo por el color.** Esperando es un
 * anillo, Lavando un punto con halo, Listo un punto lleno. Así se distingue
 * de un vistazo con el celular al sol, y también para quien no distingue bien
 * los colores.
 */
import type { AppointmentStatus } from '../types';

interface Estado {
  label: string;
  /** Clases de la pastilla con el nombre del estado. */
  pastilla: string;
  /** Clases del punto que identifica el estado. */
  punto: string;
  /** Color del borde izquierdo de la tarjeta, cuando lo lleva. */
  borde: string;
}

export const ESTADOS: Record<AppointmentStatus, Estado> = {
  pending: {
    label: 'Esperando',
    pastilla: 'bg-gray-100 text-gray-700',
    punto: 'border-2 border-gray-500 bg-transparent',
    borde: 'border-l-gray-300',
  },
  in_progress: {
    label: 'Lavando',
    pastilla: 'bg-blue-100 text-blue-800',
    punto: 'bg-blue-600 ring-[3px] ring-blue-600/25',
    borde: 'border-l-blue-600',
  },
  done: {
    label: 'Listo',
    pastilla: 'bg-green-100 text-green-800',
    punto: 'bg-green-600',
    borde: 'border-l-green-600',
  },
  delivered: {
    label: 'Entregado',
    pastilla: 'bg-gray-100 text-gray-500',
    punto: 'bg-gray-400',
    borde: 'border-l-gray-200',
  },
  cancelled: {
    label: 'Cancelado',
    pastilla: 'bg-red-100 text-red-800',
    punto: 'bg-red-600',
    borde: 'border-l-red-600',
  },
};

export function PuntoEstado({ status }: { status: AppointmentStatus }) {
  const e = ESTADOS[status] ?? ESTADOS.pending;
  return <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${e.punto}`} />;
}

export function PastillaEstado({ status }: { status: AppointmentStatus }) {
  const e = ESTADOS[status] ?? ESTADOS.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded ${e.pastilla}`}>
      <PuntoEstado status={status} />
      {e.label}
    </span>
  );
}

/** La placa, dibujada como placa: amarilla con letras negras. Ver `.placa` en index.css. */
export function Placa({ placa, className = '' }: { placa: string; className?: string }) {
  return <span className={`placa text-sm ${className}`}>{placa}</span>;
}
