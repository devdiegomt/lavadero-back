import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { formatCOP } from '../lib/format';
import { useToast } from '../components/ui';
import QuickTurnModal from '../components/QuickTurnModal';
import { ESTADOS, Placa, PuntoEstado } from '../lib/estados';
import { CalendarDays, Columns3, History, Plus, Users, type LucideIcon } from 'lucide-react';
import type { AppointmentStatus } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayStats {
  appointments: {
    total_appointments: number | string;
    in_progress: number | string;
    done: number | string;
  };
  revenue: { total: number };
}

interface SummaryAppointment {
  id: string;
  status: AppointmentStatus;
  plate: string;
  service_name: string;
}

// ─── DashboardPage ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  const toast      = useToast();
  const [stats, setStats]                 = useState<DayStats | null>(null);
  const [loading, setLoading]             = useState(true);
  const [showQuickTurn, setShowQuickTurn] = useState(false);

  const fetchStats = useCallback(() => {
    return api<DayStats>('/tenants/me/stats')
      .then(setStats)
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetchStats().finally(() => setLoading(false));
  }, [fetchStats]);

  const handleQuickTurnCreated = () => {
    setShowQuickTurn(false);
    toast.success('Turno creado exitosamente');
    fetchStats();
  };

  const greeting = (): string => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Buenos días';
    if (hour < 18) return 'Buenas tardes';
    return 'Buenas noches';
  };

  const hoy = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-[1.9rem] font-semibold text-gray-900" style={{ fontStretch: '118%' }}>
            {greeting()}, {user?.firstName}
          </h1>
          <p className="text-gray-500 text-sm mt-1.5 first-letter:uppercase">{hoy}</p>
        </div>
        <button
          onClick={() => setShowQuickTurn(true)}
          className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
        >
          <Plus aria-hidden="true" size={17} strokeWidth={2} />
          Nuevo turno
        </button>
      </div>

      {/* Stats: una sola franja dividida, no cuatro tarjetas sueltas */}
      {loading ? (
        <div className="h-24 bg-white border border-gray-100 rounded-xl animate-pulse" />
      ) : stats ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-gray-100 rounded-xl divide-gray-100 [&>*]:border-gray-100 [&>*:nth-child(n+3)]:border-t lg:[&>*:nth-child(n+3)]:border-t-0 [&>*:nth-child(even)]:border-l lg:[&>*:not(:first-child)]:border-l">
          <StatCard label="Turnos hoy" value={stats.appointments.total_appointments} />
          <StatCard label="Lavando" value={stats.appointments.in_progress} />
          <StatCard label="Listos" value={stats.appointments.done} />
          <StatCard label="Ingresos hoy" value={formatCOP(stats.revenue.total)} />
        </div>
      ) : null}

      {/* Live board summary */}
      <LiveBoardSummary />

      {/* Accesos */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickAction href="/appointments" icon={CalendarDays} label="Ver agenda" />
        <QuickAction href="/board" icon={Columns3} label="Tablero" />
        <QuickAction href="/customers" icon={Users} label="Clientes" />
        <QuickAction href="/history" icon={History} label="Historial" />
      </div>

      {/* Quick turn modal */}
      {showQuickTurn && (
        <QuickTurnModal
          onClose={() => setShowQuickTurn(false)}
          onCreated={handleQuickTurnCreated}
        />
      )}
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: ReactNode;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="px-5 py-4 grid gap-2">
      <span className="etiqueta text-gray-500">{label}</span>
      <p className="cifra text-[1.7rem] leading-none font-semibold text-gray-900 whitespace-nowrap">{value}</p>
    </div>
  );
}

// ─── QuickAction ──────────────────────────────────────────────────────────────

interface QuickActionProps {
  href: string;
  icon: LucideIcon;
  label: string;
}

function QuickAction({ href, icon: Icono, label }: QuickActionProps) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(href)}
      className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-100 bg-white hover:border-gray-300 transition text-sm font-medium text-gray-700 text-left w-full"
    >
      <Icono aria-hidden="true" size={18} strokeWidth={1.6} className="text-gray-400" />
      {label}
    </button>
  );
}

// ─── LiveBoardSummary ─────────────────────────────────────────────────────────

function LiveBoardSummary() {
  const [appointments, setAppointments] = useState<SummaryAppointment[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    api<SummaryAppointment[]>('/appointments/today').then(setAppointments).catch(() => {});
  }, []);

  const active = appointments.filter((a) => ['pending', 'in_progress', 'done'].includes(a.status));
  if (active.length === 0) return null;

  const byStatus = {
    pending:     active.filter((a) => a.status === 'pending'),
    in_progress: active.filter((a) => a.status === 'in_progress'),
    done:        active.filter((a) => a.status === 'done'),
  };

  const columnas: { status: AppointmentStatus; label: string; items: SummaryAppointment[] }[] = [
    { status: 'pending', label: 'Esperando', items: byStatus.pending },
    { status: 'in_progress', label: 'Lavando', items: byStatus.in_progress },
    { status: 'done', label: 'Listos', items: byStatus.done },
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-gray-900">En el lavadero ahora</h2>
        <button
          onClick={() => navigate('/board')}
          className="text-sm text-brand-700 hover:text-brand-800 font-medium"
        >
          Ver tablero
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {columnas.map((c) => (
          <MiniColumn key={c.status} status={c.status} label={c.label} items={c.items} />
        ))}
      </div>
    </section>
  );
}

// ─── MiniColumn ───────────────────────────────────────────────────────────────

interface MiniColumnProps {
  status: AppointmentStatus;
  label: string;
  items: SummaryAppointment[];
}

function MiniColumn({ status, label, items }: MiniColumnProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 pb-1">
        <PuntoEstado status={status} />
        <span className="etiqueta font-semibold text-gray-500">{label}</span>
        <span className="ml-auto font-mono text-xs text-gray-700">{items.length}</span>
      </div>
      {items.length === 0 && <p className="text-xs text-gray-400 py-2">Ninguno</p>}
      {items.slice(0, 3).map((a) => (
        <div key={a.id} className={`bg-white border border-gray-100 border-l-[3px] ${ESTADOS[status].borde} rounded-lg px-3 py-2.5 space-y-1.5`}>
          <Placa placa={a.plate} />
          <p className="text-xs text-gray-500">{a.service_name}</p>
        </div>
      ))}
      {items.length > 3 && (
        <p className="text-xs text-gray-500 pl-1">y {items.length - 3} más</p>
      )}
    </div>
  );
}
