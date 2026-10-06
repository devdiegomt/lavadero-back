import { useLocation } from 'react-router-dom';
import { Construction, SlidersHorizontal, type LucideIcon } from 'lucide-react';

interface PageInfo {
  icon: LucideIcon;
  name: string;
  phase: string;
}

const PAGES: Record<string, PageInfo> = {
  '/settings': { icon: SlidersHorizontal, name: 'Configuración', phase: 'Fase 1 - Semana 4' },
};

const FALLBACK: PageInfo = { icon: Construction, name: 'Página', phase: 'Próximamente' };

export default function PlaceholderPage() {
  const { pathname } = useLocation();
  const page = PAGES[pathname] ?? FALLBACK;

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <page.icon aria-hidden="true" size={40} strokeWidth={1.3} className="mb-4 text-gray-400" />
      <h2 className="text-xl font-semibold text-gray-900 mb-2">{page.name}</h2>
      <p className="text-gray-500 text-sm mb-6">En construcción — {page.phase}</p>
      <div className="border border-gray-100 bg-white rounded-xl px-6 py-4 max-w-sm">
        <p className="text-gray-600 text-sm">
          Este módulo se construirá según el plan de desarrollo incremental.
          Primero terminamos lo anterior antes de abrir nuevos frentes.
        </p>
      </div>
    </div>
  );
}