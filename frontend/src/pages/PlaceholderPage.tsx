import { useLocation } from 'react-router-dom';

interface PageInfo {
  icon: string;
  name: string;
  phase: string;
}

const PAGES: Record<string, PageInfo> = {
  '/settings': { icon: '⚙️', name: 'Configuración', phase: 'Fase 1 - Semana 4' },
};

const FALLBACK: PageInfo = { icon: '🚧', name: 'Página', phase: 'Próximamente' };

export default function PlaceholderPage() {
  const { pathname } = useLocation();
  const page = PAGES[pathname] ?? FALLBACK;

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <span className="text-6xl mb-4">{page.icon}</span>
      <h2 className="text-xl font-bold text-gray-900 mb-2">{page.name}</h2>
      <p className="text-gray-500 text-sm mb-6">En construcción — {page.phase}</p>
      <div className="bg-brand-50 rounded-xl px-6 py-4 max-w-sm">
        <p className="text-brand-700 text-sm">
          Este módulo se construirá según el plan de desarrollo incremental.
          Primero terminamos lo anterior antes de abrir nuevos frentes.
        </p>
      </div>
    </div>
  );
}