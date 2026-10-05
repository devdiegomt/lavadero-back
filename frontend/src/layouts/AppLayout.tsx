import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  Columns3,
  History,
  Home,
  LogOut,
  ReceiptText,
  SlidersHorizontal,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import PlateSearch from '../components/PlateSearch';
import InstallPrompt from '../components/InstallPrompt';
import type { UserRole } from '../types';

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',             icon: Home,              label: 'Inicio' },
  { to: '/board',        icon: Columns3,          label: 'Tablero' },
  { to: '/appointments', icon: CalendarDays,      label: 'Agenda' },
  { to: '/payments',     icon: Wallet,            label: 'Pagos' },
  { to: '/history',      icon: History,           label: 'Historial' },
  { to: '/billing',      icon: ReceiptText,       label: 'Facturación', adminOnly: true },
  { to: '/reports',      icon: BarChart3,         label: 'Reportes',    adminOnly: true },
  { to: '/customers',    icon: Users,             label: 'Clientes' },
  { to: '/settings',     icon: SlidersHorizontal, label: 'Config',      adminOnly: true },
];

const ROLES: Record<string, string> = {
  admin: 'Administrador',
  operator: 'Operario',
  super_admin: 'Superadministrador',
};

const isAdmin = (role: UserRole | undefined): boolean =>
  role === 'admin' || role === 'super_admin';

/** El nombre del lavadero, en Archivo ancha y mayúsculas espaciadas. */
function Marca({ nombre, compacta = false }: { nombre?: string; compacta?: boolean }) {
  return (
    <div className="min-w-0">
      {/* En la barra lateral el nombre puede ocupar dos líneas: cortado con
          «…» el nombre del lavadero era lo primero que se perdía. */}
      <p
        className={`font-semibold uppercase text-gray-900 leading-snug ${compacta ? 'text-xs truncate' : 'text-sm line-clamp-2'}`}
        style={{ fontStretch: '118%', letterSpacing: '0.12em' }}
      >
        {nombre ?? 'Carwash'}
      </p>
      {!compacta && <p className="etiqueta text-gray-500 mt-0.5">Panel del lavadero</p>}
    </div>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin(user?.role));
  const iniciales = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`;

  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:sticky lg:top-0 lg:h-screen bg-lateral border-r border-gray-100">
        <div className="px-6 pt-7 pb-6">
          <Marca nombre={user?.tenant?.name} />
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {visibleItems.map(({ to, icon: Icono, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
                  isActive
                    ? 'bg-gray-100 text-gray-900 font-semibold'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100/60'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icono
                    aria-hidden="true"
                    size={18}
                    strokeWidth={1.6}
                    className={isActive ? 'text-brand-600' : 'text-gray-400 group-hover:text-gray-600'}
                  />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 pb-3">
          <PlateSearch />
        </div>

        {/* User */}
        <div className="px-3 py-4 border-t border-gray-100 space-y-1">
          <div className="flex items-center gap-3 px-3 py-1">
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-800 font-semibold text-xs shrink-0">
              {iniciales}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-gray-500 truncate">{ROLES[user?.role ?? ''] ?? user?.role}</p>
            </div>
            <button
              onClick={logout}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="text-gray-400 hover:text-gray-800 transition p-1.5 rounded-lg hover:bg-gray-100"
            >
              <LogOut aria-hidden="true" size={17} strokeWidth={1.6} />
            </button>
          </div>

          {/* Con su nombre. La primera versión hacía clickeable el bloque de
              arriba y nada más: se veía exactamente igual que antes, así que
              nadie podía adivinar que llevaba a algún lado. Una función que no
              se encuentra es una función que no existe. */}
          <NavLink
            to="/cuenta"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                isActive ? 'bg-gray-100 text-gray-900 font-semibold' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100/60'
              }`
            }
          >
            <UserRound aria-hidden="true" size={17} strokeWidth={1.6} className="text-gray-400" />
            Mi cuenta
          </NavLink>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 pb-20 lg:pb-0">
        {/* Mobile header */}
        <header className="lg:hidden sticky top-0 z-30 bg-lateral border-b border-gray-100 px-4 py-3 flex items-center justify-between gap-3">
          <Marca nombre={user?.tenant?.name} compacta />
          <div className="flex items-center gap-1 shrink-0">
            <PlateSearch />
            {/* En móvil la barra lateral no existe, así que el acceso a la
                cuenta tiene que estar acá o no está en ningún lado. */}
            <NavLink
              to="/cuenta"
              className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition whitespace-nowrap"
            >
              Mi cuenta
            </NavLink>
            <button
              onClick={logout}
              className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition"
            >
              Salir
            </button>
          </div>
        </header>

        <div className="p-4 lg:p-10 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-lateral border-t border-gray-100 px-1 flex justify-around safe-area-bottom">
        {visibleItems.slice(0, 5).map(({ to, icon: Icono, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 pt-2.5 pb-2 px-3 text-[0.68rem] font-medium transition border-t-2 ${
                isActive ? 'text-gray-900 border-brand-600' : 'text-gray-500 border-transparent'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icono
                  aria-hidden="true"
                  size={20}
                  strokeWidth={1.6}
                  className={isActive ? 'text-brand-600' : ''}
                />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* PWA install prompt */}
      <InstallPrompt />
    </div>
  );
}
