import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ShieldCheck } from 'lucide-react';

export default function SuperAdminLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Con una franja de latón arriba para que no se confunda con el panel de
          un lavadero: esta cuenta ve a todos. */}
      <header className="bg-lateral border-t-2 border-brand-600 border-b border-b-gray-100 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-brand-50 border border-brand-300 flex items-center justify-center shrink-0">
              <ShieldCheck aria-hidden="true" size={18} strokeWidth={1.6} className="text-brand-700" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-sm text-gray-900">Superadministrador</h1>
              <p className="text-xs text-gray-500 truncate">Panel global del SaaS</p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:block text-right">
              <p className="text-xs font-medium text-gray-900 truncate max-w-[160px]">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-gray-500 truncate max-w-[160px]">{user?.email}</p>
            </div>
            {/* Con su nombre, no colgado del nombre del usuario: esta es la
                cuenta que ve todos los lavaderos, y que pueda rotar su
                contraseña sin correr un script es justamente el punto. */}
            <NavLink
              to="/admin/cuenta"
              className="text-xs text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition whitespace-nowrap"
            >
              Mi cuenta
            </NavLink>
            <button
              onClick={logout}
              className="text-xs text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}