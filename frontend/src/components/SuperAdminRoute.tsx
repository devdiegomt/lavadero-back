import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { ReactNode } from 'react';

/**
 * Guard de ruta para el panel de super_admin.
 * - Si está cargando → spinner
 * - Si no está autenticado → /login
 * - Si está autenticado pero no es super_admin → / (su lavadero)
 * - Si es super_admin → renderiza children
 */
export default function SuperAdminRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div aria-hidden="true" className="w-7 h-7 mx-auto border-2 border-gray-200 border-t-brand-600 rounded-full animate-spin" />
          <p className="text-sm text-gray-500 mt-3">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'super_admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}