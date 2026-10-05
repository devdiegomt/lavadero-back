import { useState, useRef, useEffect } from 'react';
import { CarFront, Phone, Search } from 'lucide-react';
import { PastillaEstado, Placa } from '../lib/estados';
import { api, ApiError } from '../lib/api';
import { formatCOP } from '../lib/format';
import type { AppointmentStatus } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VehicleResult {
  plate: string;
  vehicle_type: string;
  brand: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
}

interface CustomerResult {
  first_name: string;
  last_name: string | null;
  phone: string;
  email: string | null;
}

interface AppointmentResult {
  id: string;
  service_name: string;
  scheduled_date: string;
  price: number;
  status: AppointmentStatus;
}

interface SearchResult {
  vehicle: VehicleResult;
  customer: CustomerResult | null;
  appointments: AppointmentResult[];
}

// ─── PlateSearch ──────────────────────────────────────────────────────────────

export default function PlateSearch() {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [result, setResult]   = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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
      // Un solo fetch: el endpoint de historial trae vehículo + cliente + últimas citas.
      const data = await api<{ vehicle: VehicleResult; customer: CustomerResult | null; appointments: AppointmentResult[] }>(
        `/history/vehicle/${encodeURIComponent(query.trim())}`,
      );
      setResult({
        vehicle: data.vehicle,
        customer: data.customer,
        appointments: (data.appointments ?? []).slice(0, 5),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError('No se encontró un vehículo con esa placa');
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-gray-200 hover:border-gray-300 text-gray-500 hover:text-gray-700 transition text-sm"
        title="Buscar por placa"
        aria-label="Buscar por placa"
      >
        <Search aria-hidden="true" size={16} strokeWidth={1.6} />
        <span className="hidden sm:inline">Buscar placa</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />

      <div className="relative bg-white border border-gray-100 w-full max-w-md rounded-xl shadow-2xl shadow-black/50 mx-4 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <Search aria-hidden="true" size={19} strokeWidth={1.6} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Buscar por placa..."
            className="flex-1 min-w-0 bg-transparent text-lg font-mono font-semibold tracking-[0.12em] text-gray-900 outline-none uppercase placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-sm placeholder:text-gray-400"
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
                  <Placa placa={result.vehicle.plate} className="!text-xl" />
                  <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded font-medium">
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
              {result.customer && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Cliente</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-sm text-gray-900">
                        {result.customer.first_name} {result.customer.last_name}
                      </p>
                      <p className="text-xs text-gray-500">{result.customer.phone}</p>
                      {result.customer.email && (
                        <p className="text-xs text-gray-400">{result.customer.email}</p>
                      )}
                    </div>
                    {result.customer.phone && (
                      <a
                        href={`tel:${result.customer.phone}`}
                        className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-800 px-3 py-2 rounded-lg text-xs font-medium hover:border-gray-300 transition"
                      >
                        <Phone aria-hidden="true" size={14} strokeWidth={1.8} />
                        Llamar
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Recent appointments */}
              {result.appointments.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Últimos servicios</p>
                  <div className="space-y-2">
                    {result.appointments.map((a) => (
                      <div key={a.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
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
              <CarFront aria-hidden="true" size={34} strokeWidth={1.3} className="mx-auto mb-3 text-gray-400" />
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

// ─── StatusPill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: AppointmentStatus }) {
  return <PastillaEstado status={status} />;
}
