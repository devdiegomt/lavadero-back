import { Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function SuperAdminLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header oscuro para diferenciar del panel de tenant */}
      <header className="bg-gray-900 text-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center text-lg shrink-0">
              👑
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-sm">Super Admin</h1>
              <p className="text-xs text-gray-400 truncate">Panel global del SaaS</p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:block text-right">
              <p className="text-xs font-medium truncate max-w-[160px]">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-gray-400 truncate max-w-[160px]">{user?.email}</p>
            </div>
            <button
              onClick={logout}
              className="text-xs text-gray-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/10 transition"
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