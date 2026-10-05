// ─── PaymentModal.tsx ─────────────────────────────────────────────────────────
import { useState } from 'react';
import { api } from '../lib/api';
import { formatCOP } from '../lib/format';
import type { PaymentMethod } from '../types';
import { METODOS_PAGO as METHODS } from '../lib/metodos-pago';
import { Placa } from '../lib/estados';
import { X } from 'lucide-react';

interface AppointmentForPayment {
  id: string;
  price: number;        // centavos
  plate?: string;
  service_name?: string;
  customer_first_name?: string;
  customer_last_name?: string | null;
  total_amount?: number; // alias
}

interface PaymentModalProps {
  appointment: AppointmentForPayment;
  onClose(): void;
  onSaved?(): void;
}


export default function PaymentModal({ appointment, onClose, onSaved }: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const amount = appointment.price ?? appointment.total_amount ?? 0;
  const [amountPesos, setAmountPesos] = useState(Math.round(amount / 100));
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const amountCentavos = Math.round(parseFloat(String(amountPesos) || '0') * 100);

  const handleSave = async () => {
    setError(''); setLoading(true);
    try {
      await api('/payments', {
        method: 'POST',
        body: { appointmentId: appointment.id, amount: amountCentavos, paymentMethod: method, notes: notes || undefined },
      });
      onSaved?.();
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white border border-gray-100 w-full max-w-sm rounded-t-xl sm:rounded-xl p-5 space-y-4 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Registrar pago</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-800 p-1"><X aria-hidden="true" size={20} /></button>
        </div>

        {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>}

        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-sm text-gray-900 flex items-center gap-2">{appointment.plate && <Placa placa={appointment.plate} />}{appointment.service_name}</p>
          <p className="text-xs text-gray-500">{appointment.customer_first_name} {appointment.customer_last_name}</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Monto en pesos</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
            <input title="Monto en pesos" type="number" inputMode="numeric" value={amountPesos}
              onChange={(e) => setAmountPesos(Number(e.target.value))}
              className="w-full pl-7 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Método de pago</label>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((m) => (
              <button key={m.value} onClick={() => setMethod(m.value)}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition text-xs font-medium ${
                  method === m.value ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                <m.icon aria-hidden="true" size={20} strokeWidth={1.6} />
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notas (opcional)</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: Pagó con billete de 50.000"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
        </div>

        <button onClick={handleSave} disabled={loading || !amountCentavos}
          className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg transition disabled:opacity-50 text-sm">
          {loading ? 'Registrando...' : `Cobrar ${formatCOP(amountCentavos)}`}
        </button>
      </div>
    </div>
  );
}