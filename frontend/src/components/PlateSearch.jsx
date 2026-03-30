import { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api';
import { formatCOP } from '../lib/format';

export default function PlateSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setResult(null);
      setError('');
    }
  }, [open]);

  const handleSearch = async () => {
    if (!query.trim() || query.trim().length < 3) return;
    setError('');
    setLoading(true);
    setResult(null);

    try {
      const vehicle = await api(`/vehicles/plate/${query.trim()}`);

      // Fetch recent appointments for this vehicle
      const aptData = await api(`/appointments?limit=5&date=`).catch(() => ({ data: [] }));
      // Actually filter by vehicle in a simple way — fetch from appointments endpoint
      const allRecent = await api(`/appointments?limit=100`).catch(() => ({ data: [] }));
      const vehicleApts = (allRecent.data || [])
        .filter(a => a.vehicle_id === vehicle.id)
        .slice(0, 5);

      setResult({ vehicle, appointments: vehicleApts });
    } catch (err) {
      if (err.status === 404) {
        setError('No se encontró un vehículo con esa placa');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 transition text-sm"
        title="Buscar por placa"
      >
        <span>🔍</span>
        <span className="hidden sm:inline">Buscar placa...</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />

      <div className="relative bg-white w-full max-w-md rounded-2xl shadow-2xl mx-4 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <span className="text-xl">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Buscar por placa..."
            className="flex-1 text-lg font-bold tracking-wider outline-none uppercase placeholder:font-normal placeholder:tracking-normal placeholder:text-sm"
            maxLength={7}
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {loading ? '...' : 'Buscar'}
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {error && (
            <div className="p-4 text-center">
              <p className="text-gray-500 text-sm">{error}</p>
            </div>
          )}

          {result && (
            <div className="p-4 space-y-4">
              {/* Vehicle card */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl font-bold tracking-wider text-gray-900">
                    {result.vehicle.plate}
                  </span>
                  <span className="text-xs bg-brand-100 text-brand-700 px-2 py-1 rounded-lg font-medium">
                    {result.vehicle.vehicle_type}
                  </span>
                </div>
                <p className="text-sm text-gray-700">
                  {result.vehicle.brand} {result.vehicle.model}
                  {result.vehicle.color && <span className="text-gray-400"> · {result.vehicle.color}</span>}
                  {result.vehicle.year && <span className="text-gray-400"> · {result.vehicle.year}</span>}
                </p>
              </div>

              {/* Customer */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Cliente</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-gray-900">
                      {result.vehicle.customer_first_name} {result.vehicle.customer_last_name}
                    </p>
                    <p className="text-xs text-gray-500">{result.vehicle.customer_phone}</p>
                    {result.vehicle.customer_email && (
                      <p className="text-xs text-gray-400">{result.vehicle.customer_email}</p>
                    )}
                  </div>
                  <a href={`tel:${result.vehicle.customer_phone}`}
                    className="bg-green-100 text-green-700 px-3 py-2 rounded-lg text-xs font-medium hover:bg-green-200 transition">
                    📞 Llamar
                  </a>
                </div>
              </div>

              {/* Recent appointments */}
              {result.appointments.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Últimos servicios</p>
                  <div className="space-y-2">
                    {result.appointments.map(a => (
                      <div key={a.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                        <div>
                          <p className="text-sm text-gray-700">{a.service_name}</p>
                          <p className="text-xs text-gray-400">{a.scheduled_date}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-gray-900">{formatCOP(a.price)}</p>
                          <StatusPill status={a.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!result && !error && !loading && (
            <div className="p-8 text-center">
              <span className="text-4xl block mb-2">🚗</span>
              <p className="text-sm text-gray-400">
                Escribe una placa para ver el vehículo, su dueño, y el historial de servicios
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const config = {
    pending: { label: 'Esperando', cls: 'bg-gray-100 text-gray-600' },
    in_progress: { label: 'Lavando', cls: 'bg-yellow-100 text-yellow-700' },
    done: { label: 'Listo', cls: 'bg-green-100 text-green-700' },
    delivered: { label: 'Entregado', cls: 'bg-blue-100 text-blue-700' },
    cancelled: { label: 'Cancelado', cls: 'bg-red-100 text-red-600' },
  };
  const c = config[status] || config.pending;
  return <span className={`text-xs px-2 py-0.5 rounded-full ${c.cls}`}>{c.label}</span>;
}
