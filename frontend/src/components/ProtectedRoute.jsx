import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <span className="text-4xl animate-bounce inline-block">🚿</span>
          <p className="text-sm text-gray-500 mt-3">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // El super_admin no tiene tenant_id, así que no puede usar la app del lavadero.
  // Lo redirigimos a su panel.
  if (user?.role === 'super_admin') {
    return <Navigate to="/admin" replace />;
  }

  return children;
}