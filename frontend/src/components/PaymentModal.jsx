import { useState } from 'react';
import { api } from '../lib/api';
import { formatCOP } from '../lib/format';

const METHODS = [
  { value: 'cash', label: 'Efectivo', icon: '💵' },
  { value: 'nequi', label: 'Nequi', icon: '📱' },
  { value: 'daviplata', label: 'Daviplata', icon: '📱' },
  { value: 'transfer', label: 'Transferencia', icon: '🏦' },
  { value: 'card', label: 'Tarjeta', icon: '💳' },
];

export default function PaymentModal({ appointment, onClose, onSaved }) {
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState(appointment.price);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setError('');
    setLoading(true);
    try {
      await api('/payments', {
        method: 'POST',
        body: {
          appointmentId: appointment.id,
          amount: parseInt(amount),
          paymentMethod: method,
          notes: notes || undefined,
        },
      });
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Registrar Pago</h2>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>

        {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>}

        {/* Appointment summary */}
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="font-bold text-sm text-gray-900">{appointment.plate} — {appointment.service_name}</p>
          <p className="text-xs text-gray-500">
            {appointment.customer_first_name} {appointment.customer_last_name}
          </p>
        </div>

        {/* Amount */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Monto (centavos COP)</label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              = {formatCOP(parseInt(amount) || 0)}
            </span>
          </div>
        </div>

        {/* Payment method grid */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Método de pago</label>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map(m => (
              <button
                key={m.value}
                onClick={() => setMethod(m.value)}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition text-xs font-medium ${
                  method === m.value
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-gray-100 text-gray-600 hover:border-gray-200'
                }`}
              >
                <span className="text-xl">{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notas (opcional)</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Ej: Pagó con billete de 50.000"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
        </div>

        {/* Submit */}
        <button
          onClick={handleSave}
          disabled={loading || !amount}
          className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition disabled:opacity-50 text-sm"
        >
          {loading ? 'Registrando...' : `Cobrar ${formatCOP(parseInt(amount) || 0)}`}
        </button>
      </div>
    </div>
  );
}
