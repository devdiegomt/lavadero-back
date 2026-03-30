import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { formatCOP, formatTime } from '../lib/format';
import { useToast } from '../components/ui';
import QuickTurnModal from '../components/QuickTurnModal';

const STATUS_CONFIG = {
  pending:     { label: 'Esperando', color: 'bg-gray-100 text-gray-700', dot: 'bg-gray-400' },
  in_progress: { label: 'Lavando', color: 'bg-yellow-100 text-yellow-800', dot: 'bg-yellow-400' },
  done:        { label: 'Listo', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  delivered:   { label: 'Entregado', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-400' },
  cancelled:   { label: 'Cancelado', color: 'bg-red-100 text-red-700', dot: 'bg-red-400' },
};

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const toast = useToast();

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/appointments?date=${selectedDate}&limit=100`);
      setAppointments(data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => { fetchAppointments(); }, [fetchAppointments]);

  const handleStatusChange = async (id, newStatus) => {
    try {
      await api(`/appointments/${id}/status`, {
        method: 'PATCH',
        body: { status: newStatus },
      });
      toast.success(newStatus === 'cancelled' ? 'Turno cancelado' : 'Estado actualizado');
      fetchAppointments();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleCreated = () => {
    setShowModal(false);
    toast.success('Turno creado exitosamente');
    fetchAppointments();
  };

  const isToday = selectedDate === new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Agenda</h1>
          <p className="text-sm text-gray-500">
            {appointments.length} turnos {isToday ? 'hoy' : `el ${selectedDate}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-brand-500 outline-none"
          />
          <button
            onClick={() => setShowModal(true)}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap"
          >
            + Nuevo turno
          </button>
        </div>
      </div>

      {/* Status summary pills */}
      {!loading && appointments.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {Object.entries(STATUS_CONFIG).map(([key, config]) => {
            const count = appointments.filter(a => a.status === key).length;
            if (count === 0) return null;
            return (
              <span key={key} className={`text-xs font-medium px-3 py-1 rounded-full ${config.color}`}>
                {config.label}: {count}
              </span>
            );
          })}
        </div>
      )}

      {/* Appointment list */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="bg-white rounded-xl p-4 h-28 animate-pulse" />)}
        </div>
      ) : appointments.length === 0 ? (
        <div className="text-center py-16">
          <span className="text-5xl block mb-4">📅</span>
          <p className="text-gray-500 mb-4">No hay turnos para este día</p>
          <button
            onClick={() => setShowModal(true)}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition"
          >
            Crear primer turno
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {appointments.map((apt) => (
            <AppointmentCard
              key={apt.id}
              appointment={apt}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <QuickTurnModal onClose={() => setShowModal(false)} onCreated={handleCreated} />
      )}
    </div>
  );
}

function AppointmentCard({ appointment: a, onStatusChange }) {
  const config = STATUS_CONFIG[a.status] || STATUS_CONFIG.pending;
  const nextStatus = {
    pending: 'in_progress',
    in_progress: 'done',
    done: 'delivered',
  }[a.status];

  const nextLabel = {
    pending: 'Iniciar lavado',
    in_progress: 'Marcar listo',
    done: 'Entregar',
  }[a.status];

  // Tiempo transcurrido en estado actual
  const getElapsed = () => {
    const start = a.status === 'in_progress' ? a.started_at
                : a.status === 'pending' ? a.created_at : null;
    if (!start) return null;
    const mins = Math.floor((Date.now() - new Date(start)) / 60000);
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  const elapsed = getElapsed();

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-start justify-between gap-3">
        {/* Left side */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full ${config.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
              {config.label}
            </span>
            {a.scheduled_time && (
              <span className="text-xs text-gray-400">{formatTime(a.scheduled_time)}</span>
            )}
            {elapsed && (a.status === 'pending' || a.status === 'in_progress') && (
              <span className="text-xs text-orange-500 font-medium">{elapsed}</span>
            )}
            {a.bay_number && (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">B{a.bay_number}</span>
            )}
          </div>

          <p className="font-semibold text-gray-900 text-sm">
            {a.plate} — {a.brand} {a.model} <span className="font-normal text-gray-400">{a.color}</span>
          </p>
          <p className="text-sm text-gray-500">
            {a.customer_first_name} {a.customer_last_name} — {a.customer_phone}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {a.service_name} · {formatCOP(a.price)} · ~{a.estimated_minutes} min
          </p>
          {a.operator_first_name && (
            <p className="text-xs text-gray-400">Operador: {a.operator_first_name}</p>
          )}
        </div>

        {/* Right side: action button */}
        <div className="flex flex-col gap-2 shrink-0">
          {nextStatus && (
            <button
              onClick={() => onStatusChange(a.id, nextStatus)}
              className="text-xs font-semibold px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition whitespace-nowrap"
            >
              {nextLabel}
            </button>
          )}
          {a.status !== 'cancelled' && a.status !== 'delivered' && (
            <button
              onClick={() => {
                if (confirm('¿Cancelar este turno?')) onStatusChange(a.id, 'cancelled');
              }}
              className="text-xs text-red-500 hover:text-red-700 transition"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
