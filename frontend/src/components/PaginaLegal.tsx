/**
 * El marco de las páginas legales públicas: la política de Qlarity y el aviso
 * de cada lavadero. Se leen sin iniciar sesión, en el celular de quien está
 * dejando su carro, así que priorizan lectura: una columna, texto cómodo.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import MarcaQ from './MarcaQ';

export default function PaginaLegal({
  titulo,
  subtitulo,
  version,
  children,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  version: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <article className="max-w-2xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-2.5 mb-10 text-gray-900">
          <MarcaQ size={22} className="text-brand-600" />
          <span className="text-sm font-semibold uppercase" style={{ fontStretch: '125%', letterSpacing: '0.18em' }}>
            Qlarity
          </span>
        </Link>
        <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">{titulo}</h1>
        {subtitulo && <div className="text-gray-600 mt-3 leading-relaxed">{subtitulo}</div>}
        <p className="font-mono text-xs text-gray-500 mt-4">Versión {version}</p>
        <div className="legal mt-10 space-y-10 text-[0.95rem] leading-relaxed text-gray-700">{children}</div>
      </article>
    </div>
  );
}

export function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900" style={{ fontStretch: '110%' }}>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/** Un dato del responsable; vacío se muestra resaltado como pendiente. */
export function Dato({ valor, falta }: { valor: string | null | undefined; falta: string }) {
  if (valor && valor.trim()) return <strong className="font-semibold text-gray-900">{valor}</strong>;
  return <mark className="bg-red-100 text-red-800 px-1 rounded">[por completar: {falta}]</mark>;
}
