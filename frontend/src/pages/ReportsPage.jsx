import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { formatCOP, formatDate } from '../lib/format';
import { StatCard, SkeletonCard } from '../components/ui';

export default function ReportsPage() {
  const [period, setPeriod] = useState('week');
  const [dashboard, setDashboard] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [servicesData, setServicesData] = useState(null);
  const [customersData, setCustomersData] = useState(null);
  const [operatorsData, setOperatorsData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, rev, svc, cust, ops] = await Promise.all([
        api(`/reports/dashboard?period=${period}`),
        api(`/reports/revenue?period=${period}`),
        api(`/reports/services?period=${period}`),
        api(`/reports/customers?period=${period}`),
        api(`/reports/operators?period=${period}`),
      ]);
      setDashboard(dash);
      setRevenue(rev);
      setServicesData(svc);
      setCustomersData(cust);
      setOperatorsData(ops);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [period]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const METHODS_LABEL = { cash: 'Efectivo', nequi: 'Nequi', daviplata: 'Daviplata', transfer: 'Transferencia', card: 'Tarjeta' };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">Reportes</h1>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {[{ key: 'today', label: 'Hoy' }, { key: 'week', label: 'Semana' }, { key: 'month', label: 'Mes' }].map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-4 py-2 rounded-md text-xs font-medium transition ${period === p.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <SkeletonCard count={4} height="h-24" /> : dashboard ? (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Ingresos" value={formatCOP(dashboard.summary.total_revenue)}
              change={dashboard.comparison.revenue_change_pct} icon="💰" />
            <KpiCard label="Turnos completados" value={dashboard.summary.completed}
              change={dashboard.comparison.appointment_change_pct} icon="✅" />
            <StatCard label="Clientes únicos" value={dashboard.summary.unique_customers} icon="👥" />
            <StatCard label="Ticket promedio" value={formatCOP(dashboard.summary.avg_ticket)} icon="🧾" />
          </div>

          {/* Revenue chart (bar chart using divs) */}
          {revenue && revenue.daily.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="font-semibold text-gray-900 mb-4">Ingresos por día</h2>
              <div className="flex items-end gap-1 h-40">
                {revenue.daily.map((d, i) => {
                  const maxRev = Math.max(...revenue.daily.map(x => x.revenue), 1);
                  const pct = (d.revenue / maxRev) * 100;
                  const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' });
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <span className="text-xs text-gray-400 truncate">{d.revenue > 0 ? formatCOP(d.revenue).replace('COP', '').trim() : ''}</span>
                      <div className="w-full max-w-[40px] rounded-t-md bg-brand-500 transition-all" style={{ height: `${Math.max(pct, 2)}%` }}
                        title={`${dayLabel}: ${formatCOP(d.revenue)} (${d.completed} turnos)`} />
                      <span className="text-xs text-gray-500 truncate">{dayLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Two columns: services + methods */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top services */}
            {servicesData && servicesData.services.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h2 className="font-semibold text-gray-900 mb-3">Servicios más pedidos</h2>
                <div className="space-y-3">
                  {servicesData.services.map((s, i) => {
                    const maxCount = servicesData.services[0].count;
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-700 font-medium">{s.name}</span>
                          <span className="text-gray-500">{s.count} turnos · {formatCOP(s.revenue)}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-400 rounded-full" style={{ width: `${(s.count / maxCount) * 100}%` }} />
                        </div>
                        {s.avg_minutes && <p className="text-xs text-gray-400 mt-0.5">Prom: {s.avg_minutes} min</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Payment methods */}
            {revenue && revenue.byMethod.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h2 className="font-semibold text-gray-900 mb-3">Métodos de pago</h2>
                <div className="space-y-3">
                  {revenue.byMethod.map((m, i) => {
                    const maxTotal = revenue.byMethod[0].total;
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-700 font-medium">{METHODS_LABEL[m.method] || m.method}</span>
                          <span className="text-gray-500">{formatCOP(m.total)} ({m.count})</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-green-400 rounded-full" style={{ width: `${(m.total / maxTotal) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Two columns: top customers + operators */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top customers */}
            {customersData && customersData.customers.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h2 className="font-semibold text-gray-900 mb-3">Mejores clientes</h2>
                <div className="space-y-2">
                  {customersData.customers.slice(0, 5).map((c, i) => (
                    <div key={c.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold">{i + 1}</span>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{c.first_name} {c.last_name}</p>
                          <p className="text-xs text-gray-400">{c.visit_count} visitas</p>
                        </div>
                      </div>
                      <p className="font-semibold text-sm text-gray-900">{formatCOP(c.total_spent)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Operator performance */}
            {operatorsData && operatorsData.operators.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h2 className="font-semibold text-gray-900 mb-3">Rendimiento operadores</h2>
                <div className="space-y-2">
                  {operatorsData.operators.map(op => (
                    <div key={op.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{op.first_name} {op.last_name}</p>
                        <p className="text-xs text-gray-400">
                          {op.completed} completados {op.avg_minutes ? `· ${op.avg_minutes} min prom.` : ''}
                        </p>
                      </div>
                      <p className="font-semibold text-sm text-gray-900">{formatCOP(op.revenue)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Peak hours */}
          {revenue && revenue.byHour.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Horas pico</h2>
              <div className="flex items-end gap-1 h-28">
                {Array.from({ length: 13 }, (_, i) => i + 7).map(hour => {
                  const data = revenue.byHour.find(h => h.hour === hour);
                  const count = data?.count || 0;
                  const maxCount = Math.max(...revenue.byHour.map(h => h.count), 1);
                  const pct = (count / maxCount) * 100;
                  return (
                    <div key={hour} className="flex-1 flex flex-col items-center gap-1">
                      {count > 0 && <span className="text-xs text-gray-400">{count}</span>}
                      <div className="w-full max-w-[32px] rounded-t-md transition-all"
                        style={{ height: `${Math.max(pct, 4)}%`, backgroundColor: pct > 70 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#2E86C1' }} />
                      <span className="text-xs text-gray-500">{hour}h</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400 mt-2 text-center">Rojo = horas más ocupadas</p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function KpiCard({ label, value, change, icon }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {change !== null && change !== undefined && (
        <p className={`text-xs font-medium mt-0.5 ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {change >= 0 ? '↑' : '↓'} {Math.abs(change)}% vs periodo anterior
        </p>
      )}
    </div>
  );
}
