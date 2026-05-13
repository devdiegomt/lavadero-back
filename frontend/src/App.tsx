import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ToastProvider } from './components/ui';
import ProtectedRoute from './components/ProtectedRoute';
import SuperAdminRoute from './components/SuperAdminRoute';
import AppLayout from './layouts/AppLayout';
import SuperAdminLayout from './layouts/SuperAdminLayout';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import DashboardPage from './pages/DashboardPage';
import AppointmentsPage from './pages/AppointmentsPage';
import BoardPage from './pages/BoardPage';
import CustomersPage from './pages/CustomersPage';
import PaymentsPage from './pages/PaymentsPage';
import HistoryPage from './pages/HistoryPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import BillingPage from './pages/BillingPage';
import SuperAdminPage from './pages/SuperAdminPage';

function AppRoutes() {
  const { isAuthenticated, user } = useAuth();
  const homeByRole = user?.role === 'super_admin' ? '/admin' : '/';

  return (
    <Routes>
      {/* Públicas */}
      <Route path="/login"  element={isAuthenticated ? <Navigate to={homeByRole} replace /> : <LoginPage />} />
      <Route path="/signup" element={isAuthenticated ? <Navigate to={homeByRole} replace /> : <SignupPage />} />

      {/* App del tenant */}
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="board"        element={<BoardPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="customers"    element={<CustomersPage />} />
        <Route path="payments"     element={<PaymentsPage />} />
        <Route path="billing"      element={<BillingPage />} />
        <Route path="reports"      element={<ReportsPage />} />
        <Route path="history"      element={<HistoryPage />} />
        <Route path="settings"     element={<SettingsPage />} />
      </Route>

      {/* Super admin */}
      <Route path="/admin" element={<SuperAdminRoute><SuperAdminLayout /></SuperAdminRoute>}>
        <Route index element={<SuperAdminPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}