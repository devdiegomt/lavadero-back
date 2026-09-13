import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import PlateSearch from '../components/PlateSearch';
import InstallPrompt from '../components/InstallPrompt';
import type { UserRole } from '../types';

interface NavItem {
  to: string;
  icon: string;
  label: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',             icon: '🏠', label: 'Inicio' },
  { to: '/board',        icon: '📊', label: 'Tablero' },
  { to: '/appointments', icon: '📅', label: 'Agenda' },
  { to: '/payments',     icon: '💰', label: 'Pagos' },
  { to: '/history',      icon: '🔍', label: 'Historial' },
  { to: '/billing',      icon: '🧾', label: 'Facturación', adminOnly: true },
  { to: '/reports',      icon: '📈', label: 'Reportes',    adminOnly: true },
  { to: '/customers',    icon: '👥', label: 'Clientes' },
  { to: '/settings',     icon: '⚙️', label: 'Config',      adminOnly: true },
];

const isAdmin = (role: UserRole | undefined): boolean =>
  role === 'admin' || role === 'super_admin';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin(user?.role));

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
          {visibleItems.map((item) => (
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
        <div className="p-4 border-t border-gray-100 space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm shrink-0">
              {user?.firstName?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-gray-500 truncate">{user?.role}</p>
            </div>
            {/* El contenido es un emoji, así que sin `aria-label` el nombre
                accesible del botón es «🚪»: un lector de pantalla anuncia eso.
                `title` no alcanza —sólo se usa cuando no hay contenido. */}
            <button
              onClick={logout}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="text-gray-400 hover:text-gray-600 transition p-1"
            >
              🚪
            </button>
          </div>

          {/* Con su nombre. La primera versión hacía clickeable el bloque de
              arriba y nada más: se veía exactamente igual que antes, así que
              nadie podía adivinar que llevaba a algún lado. Una función que no
              se encuentra es una función que no existe. */}
          <NavLink
            to="/cuenta"
            // El emoji entra en el nombre accesible: sin esto un lector de
            // pantalla anuncia «busto en silueta Mi cuenta». Es lo mismo que
            // pasaba con el 🚪 de cerrar sesión, y también acá lo hizo evidente
            // buscar el enlace por su nombre en vez de por su texto.
            aria-label="Mi cuenta"
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium transition ${
                isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50'
              }`
            }
          >
            <span aria-hidden="true">👤</span>
            Mi cuenta
          </NavLink>
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
            {/* En móvil la barra lateral no existe, así que el acceso a la
                cuenta tiene que estar acá o no está en ningún lado. Con texto:
                antes era un círculo con la inicial y no se entendía que fuera
                un acceso a nada. */}
            <NavLink
              to="/cuenta"
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition whitespace-nowrap"
            >
              Mi cuenta
            </NavLink>
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
        {visibleItems.slice(0, 5).map((item) => (
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