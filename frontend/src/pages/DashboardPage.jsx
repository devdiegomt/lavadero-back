import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { formatCOP } from '../lib/format';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/tenants/me/stats')
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Buenos días';
    if (hour < 18) return 'Buenas tardes';
    return 'Buenas noches';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {greeting()}, {user?.firstName} 👋
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {user?.tenant?.name} — Resumen del día
        </p>
      </div>

      {/* Stats cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl p-4 h-24 animate-pulse" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Turnos hoy"
            value={stats.appointments.total_appointments}
            icon="📋"
            color="bg-blue-50 text-blue-700"
          />
          <StatCard
            label="En lavado"
            value={stats.appointments.in_progress}
            icon="🔄"
            color="bg-yellow-50 text-yellow-700"
          />
          <StatCard
            label="Listos"
            value={stats.appointments.done}
            icon="✅"
            color="bg-green-50 text-green-700"
          />
          <StatCard
            label="Ingresos hoy"
            value={formatCOP(stats.revenue.total)}
            icon="💰"
            color="bg-emerald-50 text-emerald-700"
          />
        </div>
      ) : null}

      {/* Quick actions */}
      <div className="bg-white rounded-xl p-6 border border-gray-100">
        <h2 className="font-semibold text-gray-900 mb-4">Acciones rápidas</h2>
        <div className="grid grid-cols-2 gap-3">
          <QuickAction href="/appointments" icon="📅" label="Ver Agenda" />
          <QuickAction href="/appointments/new" icon="➕" label="Nuevo Turno" />
          <QuickAction href="/board" icon="📊" label="Tablero" />
          <QuickAction href="/customers" icon="👥" label="Clientes" />
        </div>
      </div>

      {/* Live board summary */}
      <LiveBoardSummary />
    </div>
  );
}

function StatCard({ label, value, icon, color }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs px-2 py-1 rounded-lg font-medium ${color}`}>
          {icon}
        </span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function QuickAction({ href, icon, label }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(href)}
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition text-sm font-medium text-gray-700 text-left w-full"
    >
      <span className="text-lg">{icon}</span>
      {label}
    </button>
  );
}

function LiveBoardSummary() {
  const [appointments, setAppointments] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api('/appointments/today').then(setAppointments).catch(() => {});
  }, []);

  const active = appointments.filter(a => ['pending', 'in_progress', 'done'].includes(a.status));
  if (active.length === 0) return null;

  const byStatus = {
    pending: active.filter(a => a.status === 'pending'),
    in_progress: active.filter(a => a.status === 'in_progress'),
    done: active.filter(a => a.status === 'done'),
  };

  return (
    <div className="bg-white rounded-xl p-6 border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900">En el lavadero ahora</h2>
        <button
          onClick={() => navigate('/board')}
          className="text-xs text-brand-600 hover:text-brand-800 font-medium"
        >
          Ver tablero →
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {byStatus.in_progress.length > 0 && (
          <MiniColumn label="Lavando" color="bg-yellow-400" items={byStatus.in_progress} />
        )}
        {byStatus.pending.length > 0 && (
          <MiniColumn label="Esperando" color="bg-gray-400" items={byStatus.pending} />
        )}
        {byStatus.done.length > 0 && (
          <MiniColumn label="Listos" color="bg-green-500" items={byStatus.done} />
        )}
      </div>
    </div>
  );
}

function MiniColumn({ label, color, items }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-xs font-medium text-gray-500">{label} ({items.length})</span>
      </div>
      <div className="space-y-1">
        {items.slice(0, 3).map(a => (
          <div key={a.id} className="bg-gray-50 rounded-lg px-3 py-2">
            <p className="text-xs font-bold text-gray-900">{a.plate}</p>
            <p className="text-xs text-gray-400">{a.service_name}</p>
          </div>
        ))}
        {items.length > 3 && (
          <p className="text-xs text-gray-400 pl-3">+{items.length - 3} más</p>
        )}
      </div>
    </div>
  );
}
