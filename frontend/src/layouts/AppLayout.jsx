import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import PlateSearch from '../components/PlateSearch';
import InstallPrompt from '../components/InstallPrompt';

const NAV_ITEMS = [
  { to: '/', icon: '🏠', label: 'Inicio' },
  { to: '/board', icon: '📊', label: 'Tablero' },
  { to: '/appointments', icon: '📅', label: 'Agenda' },
  { to: '/payments', icon: '💰', label: 'Pagos' },
  { to: '/history', icon: '🔍', label: 'Historial' },
  { to: '/reports', icon: '📈', label: 'Reportes', adminOnly: true },
  { to: '/customers', icon: '👥', label: 'Clientes' },
  { to: '/settings', icon: '⚙️', label: 'Config', adminOnly: true },
];

export default function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 bg-white border-r border-gray-100">
        {/* Brand */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚿</span>
            <div>
              <h1 className="font-bold text-gray-900 text-sm">Carwash</h1>
              <p className="text-xs text-gray-500 truncate">{user?.tenant?.name}</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.filter(item => !item.adminOnly || user?.role === 'admin').map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`
              }
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Plate search (desktop) */}
        <div className="px-4 pb-2">
          <PlateSearch />
        </div>

        {/* User */}
        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm">
              {user?.firstName?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-gray-500 truncate">{user?.role}</p>
            </div>
            <button
              onClick={logout}
              title="Cerrar sesión"
              className="text-gray-400 hover:text-gray-600 transition p-1"
            >
              🚪
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 pb-20 lg:pb-0">
        {/* Mobile header */}
        <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🚿</span>
            <span className="font-bold text-sm text-gray-900 truncate max-w-[140px]">{user?.tenant?.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <PlateSearch />
            <button
              onClick={logout}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition"
            >
              Salir
            </button>
          </div>
        </header>

        <div className="p-4 lg:p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-100 px-2 py-1 flex justify-around safe-area-bottom">
        {NAV_ITEMS.filter(item => !item.adminOnly || user?.role === 'admin')
          .slice(0, 5)
          .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center py-2 px-3 text-xs font-medium transition ${
                  isActive ? 'text-brand-600' : 'text-gray-400'
                }`
              }
            >
              <span className="text-xl mb-0.5">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
      </nav>
      {/* PWA install prompt */}
      <InstallPrompt />
    </div>
  );
}
