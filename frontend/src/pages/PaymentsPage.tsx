import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { formatCOP } from '../lib/format';
import type { PaymentMethod } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Payment {
  id: string;
  amount: number;
  payment_method: PaymentMethod;
  created_at: string;
  customer_first_name: string;
  customer_last_name: string | null;
  plate: string;
  service_name: string;
  received_by_name: string | null;
}

interface MethodBreakdown {
  method: string;
  count: number;
  amount: number;
}

interface Summary {
  total: { count: number; amount: number };
  byMethod: MethodBreakdown[];
}

type Range = 'today' | 'week' | 'month';

interface MethodInfo {
  value: PaymentMethod;
  label: string;
  icon: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const METHODS: MethodInfo[] = [
  { value: 'cash',      label: 'Efectivo',      icon: '💵' },
  { value: 'nequi',     label: 'Nequi',         icon: '📱' },
  { value: 'daviplata', label: 'Daviplata',      icon: '📱' },
  { value: 'transfer',  label: 'Transferencia',  icon: '🏦' },
  { value: 'card',      label: 'Tarjeta',        icon: '💳' },
];

const RANGES: { key: Range; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: 'week',  label: 'Semana' },
  { key: 'month', label: 'Mes' },
];

// ─── PaymentsPage ─────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const [payments, setPayments]     = useState<Payment[]>([]);
  const [summary, setSummary]       = useState<Summary | null>(null);
  const [loading, setLoading]       = useState(true);
  const [range, setRange]           = useState<Range>('today');
  const [pagination, setPagination] = useState({ total: 0, page: 1 });

  const getDateRange = (): { from?: string; to?: string } => {
    const today = new Date().toISOString().split('T')[0];
    if (range === 'today') return { from: today, to: today };
    if (range === 'week') {
      const d = new Date(); d.setDate(d.getDate() - 7);
      return { from: d.toISOString().split('T')[0], to: today };
    }
    if (range === 'month') {
      const d = new Date(); d.setDate(1);
      return { from: d.toISOString().split('T')[0], to: today };
    }
    return {};
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { from, to } = getDateRange();
    try {
      const params = new URLSearchParams({ page: String(pagination.page), limit: '30' });
      if (from && to) { params.set('from', from); params.set('to', to); }

      const [paymentsData, summaryData] = await Promise.all([
        api<{ data: Payment[]; pagination: { total: number } }>(`/payments?${params}`),
        api<Summary>(`/payments/summary?from=${from ?? ''}&to=${to ?? ''}`),
      ]);
      setPayments(paymentsData.data);
      setPagination((p) => ({ ...p, total: paymentsData.pagination.total }));
      setSummary(summaryData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, pagination.page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">Pagos</h1>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => { setRange(r.key); setPagination((p) => ({ ...p, page: 1 })); }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                range === r.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Total ingresos"    value={formatCOP(summary.total.amount)} icon="💰" />
          <SummaryCard label="Pagos registrados" value={summary.total.count}             icon="🧾" />
          {summary.byMethod.slice(0, 2).map((m) => {
            const method = METHODS.find((mt) => mt.value === m.method);
            return (
              <SummaryCard
                key={m.method}
                label={method?.label ?? m.method}
                value={formatCOP(m.amount)}
                sub={`${m.count} pagos`}
                icon={method?.icon ?? '💰'}
              />
            );
          })}
        </div>
      )}

      {/* Method breakdown */}
      {summary && summary.byMethod.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Por método de pago</p>
          <div className="space-y-2">
            {summary.byMethod.map((m) => {
              const method = METHODS.find((mt) => mt.value === m.method);
              const pct = summary.total.amount > 0 ? (m.amount / summary.total.amount) * 100 : 0;
              return (
                <div key={m.method} className="flex items-center gap-3">
                  <span className="text-lg w-8">{method?.icon ?? '💰'}</span>
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700">{method?.label ?? m.method}</span>
                      <span className="text-gray-900 font-semibold">{formatCOP(m.amount)}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 w-12 text-right">{m.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Payments list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="bg-white rounded-xl p-4 h-20 animate-pulse" />)}
        </div>
      ) : payments.length === 0 ? (
        <div className="text-center py-16">
          <span className="text-5xl block mb-4">💰</span>
          <p className="text-gray-500">No hay pagos registrados en este periodo</p>
        </div>
      ) : (
        <div className="space-y-2">
          {payments.map((p) => {
            const method = METHODS.find((m) => m.value === p.payment_method);
            return (
              <div key={p.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-2xl">{method?.icon ?? '💰'}</span>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-gray-900">
                      {p.plate} — {p.service_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {p.customer_first_name} {p.customer_last_name} · {method?.label ?? p.payment_method}
                      {p.received_by_name && ` · Cobró: ${p.received_by_name}`}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(p.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  </div>
                </div>
                <p className="font-bold text-gray-900 text-sm whitespace-nowrap">{formatCOP(p.amount)}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination.total > 30 && (
        <div className="flex justify-center gap-2 pt-2">
          <button
            disabled={pagination.page <= 1}
            onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
            className="text-sm px-3 py-1.5 rounded-lg border disabled:opacity-30"
          >
            ← Anterior
          </button>
          <span className="text-sm text-gray-500 py-1.5">
            Página {pagination.page} de {Math.ceil(pagination.total / 30)}
          </span>
          <button
            disabled={pagination.page >= Math.ceil(pagination.total / 30)}
            onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
            className="text-sm px-3 py-1.5 rounded-lg border disabled:opacity-30"
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── SummaryCard ──────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: string;
}

function SummaryCard({ label, value, sub, icon }: SummaryCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}