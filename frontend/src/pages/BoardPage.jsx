import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { formatCOP, formatTime } from '../lib/format';
import { useToast, usePullToRefresh } from '../components/ui';
import PaymentModal from '../components/PaymentModal';

const COLUMNS = [
  { key: 'pending',     label: 'Esperando',  icon: '⏳', color: 'border-gray-300',  headerBg: 'bg-gray-50',  dot: 'bg-gray-400' },
  { key: 'in_progress', label: 'Lavando',    icon: '🔄', color: 'border-yellow-300', headerBg: 'bg-yellow-50', dot: 'bg-yellow-400' },
  { key: 'done',        label: 'Listo',      icon: '✅', color: 'border-green-300',  headerBg: 'bg-green-50',  dot: 'bg-green-500' },
  { key: 'delivered',   label: 'Entregado',  icon: '🏁', color: 'border-blue-300',   headerBg: 'bg-blue-50',   dot: 'bg-blue-400' },
];

const NEXT_STATUS = {
  pending: 'in_progress',
  in_progress: 'done',
  done: 'delivered',
};

const NEXT_LABEL = {
  pending: 'Iniciar',
  in_progress: 'Listo',
  done: 'Entregar',
};

export default function BoardPage() {
  const [appointments, setAppointments] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDelivered, setShowDelivered] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [paymentTarget, setPaymentTarget] = useState(null);
  const refreshInterval = useRef(null);
  const toast = useToast();

  const fetchData = useCallback(async () => {
    try {
      const data = await api('/appointments/today');
      setAppointments(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  // Pull to refresh on mobile
  usePullToRefresh(fetchData);

  // Fetch operators once
  useEffect(() => {
    api('/tenants/me/operators')
      .then(setOperators)
      .catch(() => setOperators([]));
  }, []);

  // Refresh data every 30 seconds (real-time-ish for a lavadero)
  useEffect(() => {
    fetchData();
    refreshInterval.current = setInterval(fetchData, 30000);
    return () => clearInterval(refreshInterval.current);
  }, [fetchData]);

  const handleStatusChange = async (id, newStatus) => {
    // If moving to delivered, prompt for payment first
    if (newStatus === 'delivered') {
      const apt = appointments.find(a => a.id === id);
      if (apt) {
        setPaymentTarget(apt);
        return;
      }
    }

    // Optimistic update
    setAppointments(prev =>
      prev.map(a => a.id === id ? { ...a, status: newStatus } : a)
    );
    try {
      await api(`/appointments/${id}/status`, {
        method: 'PATCH',
        body: { status: newStatus },
      });
      const labels = { in_progress: 'Lavado iniciado', done: 'Marcado como listo', cancelled: 'Turno cancelado' };
      toast.success(labels[newStatus] || 'Estado actualizado');
      fetchData(); // Re-fetch to get accurate timestamps
    } catch (err) {
      toast.error(err.message);
      fetchData(); // Revert on error
    }
  };

  const handlePaymentComplete = async () => {
    if (!paymentTarget) return;
    // After payment registered, move to delivered
    try {
      await api(`/appointments/${paymentTarget.id}/status`, {
        method: 'PATCH',
        body: { status: 'delivered' },
      });
    } catch (err) {
      console.error('Error moving to delivered:', err);
    }
    setPaymentTarget(null);
    toast.success('Pago registrado y turno entregado');
    fetchData();
  };

  const handleAssign = async (appointmentId, operatorId) => {
    try {
      await api(`/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: { assignedTo: operatorId || null },
      });
      fetchData();
    } catch (err) { alert(err.message); }
  };

  const columnsToShow = showDelivered ? COLUMNS : COLUMNS.filter(c => c.key !== 'delivered');

  const getColumnAppointments = (status) =>
    appointments.filter(a => a.status === status);

  const activeCount = appointments.filter(a => !['delivered', 'cancelled'].includes(a.status)).length;
  const deliveredCount = appointments.filter(a => a.status === 'delivered').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Tablero</h1>
          <p className="text-sm text-gray-500">
            {activeCount} activos · {deliveredCount} entregados hoy
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showDelivered}
              onChange={(e) => setShowDelivered(e.target.checked)}
              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            Mostrar entregados
          </label>
          <button
            onClick={fetchData}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition"
            title="Actualizar"
          >
            🔄 Actualizar
          </button>
        </div>
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1,2,3].map(i => <div key={i} className="bg-white rounded-xl p-4 h-64 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* Desktop: horizontal columns */}
          <div className="hidden md:grid gap-4" style={{ gridTemplateColumns: `repeat(${columnsToShow.length}, minmax(0, 1fr))` }}>
            {columnsToShow.map((col) => {
              const items = getColumnAppointments(col.key);
              return (
                <div key={col.key} className={`rounded-xl border-2 ${col.color} bg-white min-h-[300px]`}>
                  <div className={`${col.headerBg} px-4 py-3 rounded-t-lg border-b`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-gray-700">
                        {col.icon} {col.label}
                      </span>
                      <span className="text-xs font-bold bg-white/80 px-2 py-0.5 rounded-full text-gray-600">
                        {items.length}
                      </span>
                    </div>
                  </div>
                  <div className="p-2 space-y-2">
                    {items.length === 0 ? (
                      <p className="text-center text-xs text-gray-400 py-8">Sin turnos</p>
                    ) : (
                      items.map((a) => (
                        <KanbanCard
                          key={a.id}
                          appointment={a}
                          operators={operators}
                          onStatusChange={handleStatusChange}
                          onAssign={handleAssign}
                          onDetail={() => setDetailId(a.id)}
                          compact
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mobile: stacked sections */}
          <div className="md:hidden space-y-4">
            {columnsToShow.map((col) => {
              const items = getColumnAppointments(col.key);
              if (items.length === 0 && col.key === 'delivered') return null;
              return (
                <div key={col.key}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`} />
                    <h2 className="font-semibold text-sm text-gray-700">
                      {col.label} ({items.length})
                    </h2>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-xs text-gray-400 pl-5 pb-2">Sin turnos</p>
                  ) : (
                    <div className="space-y-2">
                      {items.map((a) => (
                        <KanbanCard
                          key={a.id}
                          appointment={a}
                          operators={operators}
                          onStatusChange={handleStatusChange}
                          onAssign={handleAssign}
                          onDetail={() => setDetailId(a.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Detail modal */}
      {detailId && (
        <DetailModal
          appointmentId={detailId}
          operators={operators}
          onClose={() => setDetailId(null)}
          onStatusChange={(id, s) => { handleStatusChange(id, s); setDetailId(null); }}
          onAssign={handleAssign}
        />
      )}

      {/* Payment modal - appears when delivering */}
      {paymentTarget && (
        <PaymentModal
          appointment={paymentTarget}
          onClose={() => setPaymentTarget(null)}
          onSaved={handlePaymentComplete}
        />
      )}
    </div>
  );
}

// ==========================================================================
// Kanban Card
// ==========================================================================
function KanbanCard({ appointment: a, operators, onStatusChange, onAssign, onDetail, compact }) {
  const elapsed = getElapsedTime(a);
  const isOvertime = isOvertimeCheck(a);
  const nextStatus = NEXT_STATUS[a.status];
  const nextLabel = NEXT_LABEL[a.status];

  return (
    <div
      className={`bg-white rounded-lg border border-gray-100 p-3 hover:shadow-sm transition cursor-pointer ${
        isOvertime ? 'ring-2 ring-orange-300' : ''
      }`}
      onClick={onDetail}
    >
      {/* Top row: plate + elapsed */}
      <div className="flex items-center justify-between mb-1">
        <span className="font-bold text-sm text-gray-900 tracking-wide">{a.plate}</span>
        {elapsed && (a.status === 'pending' || a.status === 'in_progress') && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            isOvertime ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {elapsed}
          </span>
        )}
      </div>

      {/* Vehicle info */}
      <p className="text-xs text-gray-500 truncate">
        {a.brand} {a.model} {a.color ? `· ${a.color}` : ''}
      </p>

      {/* Service */}
      <p className="text-xs text-gray-400 mt-0.5">
        {a.service_name} · {formatCOP(a.price)}
      </p>

      {/* Customer */}
      {!compact && (
        <p className="text-xs text-gray-400 mt-0.5">
          {a.customer_first_name} {a.customer_last_name} · {a.customer_phone}
        </p>
      )}

      {/* Operator assignment */}
      {(a.status === 'pending' || a.status === 'in_progress') && operators.length > 0 && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <select
            value={a.assigned_to || ''}
            onChange={(e) => onAssign(a.id, e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:ring-1 focus:ring-brand-500 outline-none"
          >
            <option value="">Sin asignar</option>
            {operators.map(op => (
              <option key={op.id} value={op.id}>
                {op.first_name} {op.last_name || ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Bay number */}
      {a.bay_number && (
        <span className="inline-block mt-1.5 text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded font-medium">
          Bahía {a.bay_number}
        </span>
      )}

      {/* Action button */}
      {nextStatus && (
        <button
          onClick={(e) => { e.stopPropagation(); onStatusChange(a.id, nextStatus); }}
          className="mt-2 w-full text-xs font-semibold py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition"
        >
          {nextLabel} →
        </button>
      )}
    </div>
  );
}

// ==========================================================================
// Detail Modal
// ==========================================================================
function DetailModal({ appointmentId, operators, onClose, onStatusChange, onAssign }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`/appointments/${appointmentId}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [appointmentId]);

  if (loading || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white rounded-2xl p-8">
          <span className="text-2xl animate-spin inline-block">🔄</span>
        </div>
      </div>
    );
  }

  const config = COLUMNS.find(c => c.key === data.status);
  const nextStatus = NEXT_STATUS[data.status];
  const nextLabel = NEXT_LABEL[data.status];
  const elapsed = getElapsedTime(data);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold tracking-wider text-gray-900">{data.plate}</span>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${config?.headerBg || ''} text-gray-700`}>
              {config?.icon} {config?.label}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Vehicle */}
          <Section title="Vehículo">
            <InfoRow label="Tipo" value={data.vehicle_type} />
            <InfoRow label="Marca / Modelo" value={`${data.brand || ''} ${data.model || ''}`} />
            <InfoRow label="Color" value={data.color} />
            {data.year && <InfoRow label="Año" value={data.year} />}
          </Section>

          {/* Customer */}
          <Section title="Cliente">
            <InfoRow label="Nombre" value={`${data.customer_first_name} ${data.customer_last_name || ''}`} />
            <InfoRow label="Teléfono" value={data.customer_phone} />
            {data.customer_email && <InfoRow label="Email" value={data.customer_email} />}
          </Section>

          {/* Service */}
          <Section title="Servicio">
            <InfoRow label="Servicio" value={data.service_name} />
            <InfoRow label="Precio" value={formatCOP(data.price)} bold />
            <InfoRow label="Duración estimada" value={`${data.estimated_minutes} min`} />
            {elapsed && <InfoRow label="Tiempo actual" value={elapsed} />}
            {data.bay_number && <InfoRow label="Bahía" value={`Bahía ${data.bay_number}`} />}
            {data.notes && <InfoRow label="Notas" value={data.notes} />}
          </Section>

          {/* Operator assignment */}
          {(data.status === 'pending' || data.status === 'in_progress') && operators.length > 0 && (
            <Section title="Operador">
              <select
                value={data.assigned_to || ''}
                onChange={(e) => onAssign(data.id, e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:ring-2 focus:ring-brand-500 outline-none"
              >
                <option value="">Sin asignar</option>
                {operators.map(op => (
                  <option key={op.id} value={op.id}>
                    {op.first_name} {op.last_name || ''}
                  </option>
                ))}
              </select>
            </Section>
          )}

          {/* Status timeline */}
          {data.status_log && data.status_log.length > 0 && (
            <Section title="Historial de estados">
              <div className="space-y-2">
                {data.status_log.map((log, i) => (
                  <div key={i} className="flex items-start gap-3 text-xs">
                    <span className="text-gray-400 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-gray-600">
                      {log.previous_status ? `${log.previous_status} → ` : ''}{log.new_status}
                      {log.first_name && <span className="text-gray-400"> por {log.first_name}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            {nextStatus && (
              <button
                onClick={() => onStatusChange(data.id, nextStatus)}
                className="flex-1 py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition text-sm"
              >
                {nextLabel} →
              </button>
            )}
            {data.status !== 'cancelled' && data.status !== 'delivered' && (
              <button
                onClick={() => {
                  if (confirm('¿Cancelar este turno?')) onStatusChange(data.id, 'cancelled');
                }}
                className="px-6 py-3 border border-red-200 text-red-600 hover:bg-red-50 font-medium rounded-xl transition text-sm"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// Small components
// ==========================================================================
function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, bold }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`text-gray-900 ${bold ? 'font-bold' : ''}`}>{value}</span>
    </div>
  );
}

// ==========================================================================
// Time helpers
// ==========================================================================
function getElapsedTime(appointment) {
  const start =
    appointment.status === 'in_progress' ? appointment.started_at :
    appointment.status === 'pending' ? appointment.created_at : null;
  if (!start) return null;

  const mins = Math.floor((Date.now() - new Date(start)) / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function isOvertimeCheck(appointment) {
  if (appointment.status !== 'in_progress') return false;
  if (!appointment.started_at || !appointment.estimated_minutes) return false;
  const elapsed = (Date.now() - new Date(appointment.started_at)) / 60000;
  return elapsed > appointment.estimated_minutes;
}
