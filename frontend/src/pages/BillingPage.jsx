import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { formatCOP, formatDateTime } from '../lib/format';
import { useToast, Badge, EmptyState, SkeletonCard, ConfirmDialog, StatCard } from '../components/ui';

const TABS = [
  { key: 'invoices', label: 'Facturas emitidas', icon: '📄' },
  { key: 'pending',  label: 'Pendientes',        icon: '⏳' },
];

const INVOICE_STATUS = {
  accepted: { label: 'Aceptada por DIAN', variant: 'success', emoji: '✅' },
  pending:  { label: 'Pendiente DIAN',     variant: 'warning', emoji: '⏳' },
  failed:   { label: 'Falló',              variant: 'danger',  emoji: '❌' },
  rejected: { label: 'Rechazada',          variant: 'danger',  emoji: '⚠️' },
  voided:   { label: 'Anulada',            variant: 'default', emoji: '🚫' },
};

const PAYMENT_METHOD_LABEL = {
  cash:         'Efectivo',
  transfer:     'Transferencia',
  nequi:        'Nequi',
  daviplata:    'Daviplata',
  card:         'Tarjeta',
  other:        'Otro',
};

export default function BillingPage() {
  const [tab, setTab] = useState('invoices');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Facturación</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'invoices' && <InvoicesTab onGoToPending={() => setTab('pending')} />}
      {tab === 'pending'  && <PendingTab />}
    </div>
  );
}

// ==========================================================================
// Invoices Tab — Lista de facturas emitidas
// ==========================================================================
function InvoicesTab({ onGoToPending }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', from: '', to: '' });
  const [page, setPage] = useState(1);

  // Acciones
  const [detailFor, setDetailFor] = useState(null);     // payment con factura para ver detalle
  const [creditNoteFor, setCreditNoteFor] = useState(null); // payment para anular
  const [confirmRetry, setConfirmRetry] = useState(null);   // payment para reintentar

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('page', page);
      qs.set('limit', 20);
      if (filters.status) qs.set('status', filters.status);
      if (filters.from)   qs.set('from', filters.from);
      if (filters.to)     qs.set('to', filters.to);

      const res = await api(`/billing/invoices?${qs}`);
      setData(res);
    } catch (err) {
      if (err.status === 403) {
        toast.error('Tu plan no incluye facturación');
      } else {
        toast.error(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [filters, page, toast]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const handleRetry = async (paymentId) => {
    try {
      await api(`/billing/retry/${paymentId}`, { method: 'POST' });
      toast.success('Factura generada correctamente');
      setConfirmRetry(null);
      fetchInvoices();
    } catch (err) {
      toast.error(err.message);
      setConfirmRetry(null);
    }
  };

  if (loading && !data) return <SkeletonCard count={4} />;

  const summary = data?.summary || { total: 0, accepted: 0, rejected: 0, failed: 0, pendingDian: 0, totalInvoiced: 0 };
  const invoices = data?.data || [];
  const totalPages = Math.ceil((data?.pagination?.total || 0) / 20);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Aceptadas"  value={summary.accepted}    icon="✅" sub={`de ${summary.total} totales`} />
        <StatCard label="Pendientes" value={summary.pendingDian} icon="⏳" />
        <StatCard label="Fallidas"   value={summary.failed + summary.rejected} icon="❌" sub={summary.failed > 0 ? 'reintentables' : ''} />
        <StatCard label="Facturado"  value={formatCOP(summary.totalInvoiced)} icon="💰" sub="solo aceptadas" />
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Estado</label>
            <select value={filters.status} onChange={e => { setFilters(f => ({...f, status: e.target.value})); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white">
              <option value="">Todos</option>
              <option value="accepted">Aceptadas</option>
              <option value="pending">Pendientes DIAN</option>
              <option value="failed">Fallidas</option>
              <option value="rejected">Rechazadas</option>
              <option value="voided">Anuladas</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
            <input type="date" value={filters.from}
              onChange={e => { setFilters(f => ({...f, from: e.target.value})); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
            <input type="date" value={filters.to}
              onChange={e => { setFilters(f => ({...f, to: e.target.value})); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
          </div>
          {(filters.status || filters.from || filters.to) && (
            <div className="flex items-end">
              <button onClick={() => { setFilters({ status: '', from: '', to: '' }); setPage(1); }}
                className="w-full text-sm text-gray-600 hover:text-gray-900 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
                Limpiar filtros
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Lista */}
      {invoices.length === 0 ? (
        <EmptyState
          icon="📄"
          title="Sin facturas todavía"
          description={summary.total === 0
            ? 'Las facturas aparecerán aquí cuando configures Alegra y registres pagos.'
            : 'Ningún resultado con esos filtros.'}
          action={summary.total === 0 ? onGoToPending : null}
          actionLabel="Ver pagos pendientes"
        />
      ) : (
        <div className="space-y-2">
          {invoices.map(inv => {
            const status = INVOICE_STATUS[inv.invoice_status] || { label: inv.invoice_status || 'Desconocido', variant: 'default', emoji: '❓' };
            return (
              <div key={inv.id} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-gray-900">
                        {inv.invoice_number || `(sin número)`}
                      </p>
                      <Badge variant={status.variant}>{status.emoji} {status.label}</Badge>
                    </div>
                    <p className="text-sm text-gray-600 mt-1 truncate">
                      {inv.first_name} {inv.last_name} · <span className="font-mono">{inv.plate}</span> · {inv.service_name}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-400">
                      <span>{formatDateTime(inv.created_at)}</span>
                      <span>·</span>
                      <span className="font-semibold text-gray-700">{formatCOP(inv.amount)}</span>
                      {inv.invoice_cufe && (
                        <>
                          <span>·</span>
                          <span className="font-mono truncate max-w-[140px]" title={inv.invoice_cufe}>
                            CUFE: {inv.invoice_cufe.slice(0, 10)}…
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Acciones */}
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-50">
                  {inv.invoice_pdf_url && (
                    <a href={inv.invoice_pdf_url} target="_blank" rel="noopener"
                      className="text-xs font-medium text-brand-600 hover:text-brand-800 px-3 py-1.5 rounded-lg hover:bg-brand-50 transition">
                      📄 Ver PDF
                    </a>
                  )}
                  <button onClick={() => setDetailFor(inv)}
                    className="text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition">
                    🔍 Detalle / Refrescar
                  </button>
                  {inv.invoice_status === 'failed' && (
                    <button onClick={() => setConfirmRetry(inv)}
                      className="text-xs font-medium text-yellow-700 hover:text-yellow-900 px-3 py-1.5 rounded-lg hover:bg-yellow-50 transition">
                      🔁 Reintentar
                    </button>
                  )}
                  {inv.invoice_status === 'accepted' && (
                    <button onClick={() => setCreditNoteFor(inv)}
                      className="text-xs font-medium text-red-600 hover:text-red-800 px-3 py-1.5 rounded-lg hover:bg-red-50 transition">
                      ❌ Nota crédito
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition">
            ← Anterior
          </button>
          <span>Página {page} de {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition">
            Siguiente →
          </button>
        </div>
      )}

      {/* Modales */}
      {detailFor && (
        <InvoiceDetailModal
          payment={detailFor}
          onClose={() => setDetailFor(null)}
          onRefresh={fetchInvoices}
        />
      )}
      {creditNoteFor && (
        <CreditNoteModal
          payment={creditNoteFor}
          onClose={() => setCreditNoteFor(null)}
          onSuccess={() => { setCreditNoteFor(null); fetchInvoices(); }}
        />
      )}
      {confirmRetry && (
        <ConfirmDialog
          title="¿Reintentar facturación?"
          message={`Se intentará generar nuevamente la factura para el pago de ${confirmRetry.first_name} (${formatCOP(confirmRetry.amount)}).`}
          confirmLabel="Reintentar"
          onConfirm={() => handleRetry(confirmRetry.id)}
          onCancel={() => setConfirmRetry(null)}
        />
      )}
    </div>
  );
}

// ==========================================================================
// Pending Tab — Pagos sin factura
// ==========================================================================
function PendingTab() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(null); // payment id en proceso
  const [page, setPage] = useState(1);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/billing/pending?page=${page}&limit=20`);
      setData(res);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  const handleGenerate = async (paymentId) => {
    setGenerating(paymentId);
    try {
      await api(`/billing/invoice/${paymentId}`, { method: 'POST' });
      toast.success('Factura generada correctamente');
      fetchPending();
    } catch (err) {
      // Si el plan no permite billing
      if (err.status === 403) {
        toast.error('Tu plan no incluye facturación. Actualiza al plan Básico o Pro.');
      } else if (err.status === 502) {
        toast.error(`Error de Alegra: ${err.message}. Verifica la configuración fiscal.`);
      } else {
        toast.error(err.message);
      }
    } finally {
      setGenerating(null);
    }
  };

  if (loading && !data) return <SkeletonCard count={4} />;

  const payments = data?.data || [];
  const totalPages = Math.ceil((data?.pagination?.total || 0) / 20);

  if (payments.length === 0) {
    return (
      <EmptyState
        icon="🎉"
        title="Todos los pagos están facturados"
        description="No hay pagos pendientes de facturación. Cuando registres nuevos pagos aparecerán aquí si Alegra está configurado en automático."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Aviso */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
        <p>
          <strong>{payments.length} {payments.length === 1 ? 'pago pendiente' : 'pagos pendientes'}</strong> de facturación electrónica.
          Genera la factura una por una o configura emisión automática al registrar el pago.
        </p>
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {payments.map(p => (
          <div key={p.id} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm text-gray-900">
                    {p.first_name} {p.last_name || ''}
                  </p>
                  {p.invoice_status === 'failed' && (
                    <Badge variant="danger">Falló previamente</Badge>
                  )}
                  {!p.document_number && (
                    <Badge variant="warning">Sin documento</Badge>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  <span className="font-mono">{p.plate}</span> · {p.service_name}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-400">
                  <span>{formatDateTime(p.created_at)}</span>
                  <span>·</span>
                  <span className="font-semibold text-gray-700">{formatCOP(p.amount)}</span>
                  <span>·</span>
                  <span>{PAYMENT_METHOD_LABEL[p.payment_method] || p.payment_method}</span>
                  {p.received_by_name && (
                    <>
                      <span>·</span>
                      <span>Cobrado por {p.received_by_name}</span>
                    </>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleGenerate(p.id)}
                disabled={generating === p.id}
                className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition disabled:opacity-50 shrink-0"
              >
                {generating === p.id ? 'Generando...' : 'Generar factura'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition">
            ← Anterior
          </button>
          <span>Página {page} de {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition">
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}

// ==========================================================================
// Invoice Detail Modal — Refresca estado desde Alegra
// ==========================================================================
function InvoiceDetailModal({ payment, onClose, onRefresh }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`/billing/invoice/${payment.id}`)
      .then(setData)
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [payment.id, toast]);

  const status = data?.invoice?.status
    ? (INVOICE_STATUS[data.invoice.status] || { label: data.invoice.status, variant: 'default', emoji: '❓' })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Detalle de factura</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>

        {loading ? (
          <SkeletonCard count={2} />
        ) : !data?.hasInvoice ? (
          <p className="text-sm text-gray-500">Este pago no tiene factura asociada.</p>
        ) : (
          <div className="space-y-4">
            {/* Status */}
            {status && (
              <div className="flex items-center gap-2">
                <Badge variant={status.variant}>{status.emoji} {status.label}</Badge>
                <span className="text-xs text-gray-400">consultado en Alegra ahora</span>
              </div>
            )}

            {/* Datos básicos */}
            <DetailRow label="Número" value={data.invoice.number || '—'} />
            <DetailRow label="Cliente" value={data.invoice.customer} />
            {data.invoice.customerEmail && <DetailRow label="Email" value={data.invoice.customerEmail} />}
            <DetailRow label="Placa" value={data.invoice.plate} mono />
            <DetailRow label="Servicio" value={data.invoice.serviceName} />
            <DetailRow label="Monto" value={formatCOP(data.invoice.amount)} bold />
            <DetailRow label="Método de pago" value={PAYMENT_METHOD_LABEL[data.invoice.paymentMethod] || data.invoice.paymentMethod} />
            <DetailRow label="Emitida" value={formatDateTime(data.invoice.createdAt)} />

            {/* CUFE (largo) */}
            {data.invoice.cufe && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">CUFE</p>
                <p className="text-xs font-mono bg-gray-50 px-2 py-1.5 rounded break-all">{data.invoice.cufe}</p>
              </div>
            )}

            {/* DIAN details */}
            {data.dianDetails && (
              <div className="border-t border-gray-100 pt-3 space-y-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">DIAN</p>
                {data.dianDetails.date && <DetailRow label="Fecha sello" value={data.dianDetails.date} />}
                {data.dianDetails.legalStatus && <DetailRow label="Estado legal" value={data.dianDetails.legalStatus} />}
              </div>
            )}

            {/* Acciones */}
            <div className="flex gap-2 pt-2">
              {data.invoice.pdfUrl && (
                <a href={data.invoice.pdfUrl} target="_blank" rel="noopener"
                  className="flex-1 text-center bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold py-2.5 rounded-lg transition">
                  📄 Abrir PDF
                </a>
              )}
              <button onClick={() => { onRefresh(); onClose(); }}
                className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-semibold py-2.5 rounded-lg transition">
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value, bold, mono }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className={`text-sm text-right ${bold ? 'font-semibold text-gray-900' : 'text-gray-700'} ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

// ==========================================================================
// Credit Note Modal — Anular factura
// ==========================================================================
function CreditNoteModal({ payment, onClose, onSuccess }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (reason.trim().length < 5) {
      toast.error('Describe brevemente el motivo de la anulación (mínimo 5 caracteres)');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api(`/billing/credit-note/${payment.id}`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      toast.success(`Nota crédito ${result.creditNote.number} generada`);
      onSuccess();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Generar nota crédito</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-900">
          ⚠️ Vas a anular la factura <strong>{payment.invoice_number}</strong> por {formatCOP(payment.amount)}.
          Esta acción se reportará a la DIAN y no se puede deshacer.
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Motivo de la anulación *</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Ej: Servicio no prestado, cliente solicita devolución, error en datos…"
            rows={3}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">Aparecerá como observación en la nota crédito.</p>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={submitting}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50">
            {submitting ? 'Generando...' : 'Generar nota crédito'}
          </button>
        </div>
      </div>
    </div>
  );
}