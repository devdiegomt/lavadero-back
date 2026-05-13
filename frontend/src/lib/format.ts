/**
 * Formatea centavos COP a string legible.
 * 2500000 → "$25.000"
 */
export function formatCOP(centavos: number): string {
  const pesos = Math.round(centavos / 100);
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(pesos);
}

/**
 * Formatea una fecha a formato colombiano.
 *
 * Acepta tanto strings "YYYY-MM-DD" (DATE de Postgres serializado) como
 * ISO completos "2024-03-15T00:00:00.000Z" (cuando pg trae DATE como Date
 * object y res.json lo serializa).
 *
 *   "2024-03-15"             → "15 mar 2024"
 *   "2024-03-15T00:00:00Z"   → "15 mar 2024"
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';

  // Si ya es ISO con hora (tiene 'T'), parse directo.
  // Si es solo "YYYY-MM-DD", añadir T12:00:00 para evitar timezone shift
  // (la conversión a UTC podría mostrar el día anterior).
  const date = dateStr.includes('T')
    ? new Date(dateStr)
    : new Date(`${dateStr}T12:00:00`);

  if (isNaN(date.getTime())) return '';

  return date.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Formatea hora.
 * "14:30" → "2:30 p.m."
 */
export function formatTime(timeStr: string | null | undefined): string {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const date = new Date();
  date.setHours(parseInt(h, 10), parseInt(m, 10));
  return date.toLocaleTimeString('es-CO', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Tiempo relativo.
 * "2024-03-15T10:30:00Z" → "hace 15 min"
 */
export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'ahora';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

/**
 * Formatea fecha+hora completa.
 * "2024-03-15T10:30:00Z" → "15 mar 2024, 10:30 a.m."
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}