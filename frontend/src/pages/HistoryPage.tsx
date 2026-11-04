import { PastillaEstado, Placa } from '../lib/estados';
import { Phone, Search, UserRound } from 'lucide-react';
import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatCOP, formatDate } from '../lib/format';
import { EmptyState, useToast } from '../components/ui';
import type { AppointmentStatus, DocumentType, VehicleType } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchVehicle {
  id: string;
  plate: string;
  brand: string | null;
  model: string | null;
  customer_first_name: string;
  customer_last_name: string | null;
  customer_phone: string;
}

interface SearchCustomer {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string;
  visit_count: number;
  vehicle_count: number;
}

interface SearchResults {
  vehicles: SearchVehicle[];
  customers: SearchCustomer[];
}

interface ApiVehicle {
  id: string;
  plate: string;
  vehicle_type: VehicleType;
  brand: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
}

interface ApiCustomer {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string;
  email: string | null;
  document_type: DocumentType;
  document_number: string | null;
}

interface ApiAppointment {
  id: string;
  status: AppointmentStatus;
  scheduled_date: string;
  service_name: string;
  plate?: string;
  price?: number;
  paid_amount?: number;
  payment_method?: string | null;
}

interface VehicleStats {
  completed_visits: number;
  total_spent: number;
  avg_service_minutes: number | null;
  favorite_service: string | null;
}

interface CustomerStats {
  total_visits: number;
  total_spent: number;
  vehicle_count: number;
  last_visit: string | null;
}

interface VehicleData {
  vehicle: ApiVehicle;
  customer: ApiCustomer;
  stats: VehicleStats;
  appointments: ApiAppointment[];
}

interface CustomerData {
  customer: ApiCustomer;
  vehicles: ApiVehicle[];
  stats: CustomerStats;
  appointments: ApiAppointment[];
}

type View = 'search' | 'vehicle' | 'customer';

// ─── Constants ────────────────────────────────────────────────────────────────

// ─── HistoryPage ──────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const toast = useToast();
  const [query, setQuery]                 = useState('');
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [vehicleData, setVehicleData]     = useState<VehicleData | null>(null);
  const [customerData, setCustomerData]   = useState<CustomerData | null>(null);
  const [loading, setLoading]             = useState(false);
  const [view, setView]                   = useState<View>('search');

  useEffect(() => {
    if (query.length < 2) { setSearchResults(null); return; }
    const timer = setTimeout(async () => {
      try {
        setSearchResults(await api<SearchResults>(`/history/search?q=${encodeURIComponent(query)}`));
      } catch {
        setSearchResults(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const openVehicle = async (plate: string) => {
    setLoading(true);
    try {
      setVehicleData(await api<VehicleData>(`/history/vehicle/${plate}`));
      setView('vehicle');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const openCustomer = async (id: string) => {
    setLoading(true);
    try {
      setCustomerData(await api<CustomerData>(`/history/customer/${id}`));
      setView('customer');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    setView('search');
    setVehicleData(null);
    setCustomerData(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {view !== 'search' && (
          <button onClick={goBack} className="text-brand-600 hover:text-brand-800 text-sm font-medium">
            ← Volver
          </button>
        )}
        <h1 className="text-xl font-semibold text-gray-900">Historial</h1>
      </div>

      {view === 'search' && (
        <>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por placa, nombre, teléfono o cédula..."
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            autoFocus
          />
          {searchResults ? (
            <div className="space-y-4">
              {searchResults.vehicles.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Vehículos</p>
                  <div className="space-y-2">
                    {searchResults.vehicles.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => openVehicle(v.plate)}
                        className="w-full bg-white rounded-xl border border-gray-100 p-4 text-left hover:shadow-sm transition"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <Placa placa={v.plate} />
                            <span className="text-gray-400 text-xs ml-2">{v.brand} {v.model}</span>
                          </div>
                          <span className="text-brand-600 text-xs">Ver historial →</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {v.customer_first_name} {v.customer_last_name} · {v.customer_phone}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {searchResults.customers.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Clientes</p>
                  <div className="space-y-2">
                    {searchResults.customers.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => openCustomer(c.id)}
                        className="w-full bg-white rounded-xl border border-gray-100 p-4 text-left hover:shadow-sm transition"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-semibold text-sm">{c.first_name} {c.last_name}</span>
                            <span className="text-gray-400 text-xs ml-2">{c.phone}</span>
                          </div>
                          <span className="text-brand-600 text-xs">Ver perfil →</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {c.visit_count} visitas · {c.vehicle_count} vehículo{c.vehicle_count !== 1 ? 's' : ''}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {searchResults.vehicles.length === 0 && searchResults.customers.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-8">No se encontraron resultados</p>
              )}
            </div>
          ) : !query ? (
            <EmptyState icon={Search} title="Busca por placa, nombre o teléfono" description="Escribe al menos 2 caracteres para buscar" />
          ) : null}
        </>
      )}

      {loading && <div className="bg-white rounded-xl h-32 animate-pulse" />}
      {view === 'vehicle'  && vehicleData  && <VehicleHistory  data={vehicleData}  onCustomerClick={openCustomer} />}
      {view === 'customer' && customerData && <CustomerHistory data={customerData} onVehicleClick={openVehicle} />}
    </div>
  );
}

// ─── VehicleHistory ───────────────────────────────────────────────────────────

interface VehicleHistoryProps {
  data: VehicleData;
  onCustomerClick(id: string): void;
}

function VehicleHistory({ data, onCustomerClick }: VehicleHistoryProps) {
  const { vehicle, customer, stats, appointments } = data;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-2">
          <Placa placa={vehicle.plate} className="!text-2xl" />
          <span className="text-xs bg-gray-100 text-gray-700 px-3 py-1 rounded font-medium">
            {vehicle.vehicle_type}
          </span>
        </div>
        <p className="text-sm text-gray-600">
          {vehicle.brand} {vehicle.model}
          {vehicle.color && ` · ${vehicle.color}`}
          {vehicle.year && ` · ${vehicle.year}`}
        </p>
        <button
          onClick={() => onCustomerClick(customer.id)}
          className="inline-flex items-center gap-1.5 text-sm text-brand-700 mt-3 hover:underline"
        >
          <UserRound aria-hidden="true" size={15} strokeWidth={1.7} />
          {customer.first_name} {customer.last_name} · {customer.phone}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Visitas"        value={stats.completed_visits} />
        <MiniStat label="Total gastado"  value={formatCOP(stats.total_spent)} />
        <MiniStat label="Prom. servicio" value={stats.avg_service_minutes ? `${stats.avg_service_minutes} min` : '-'} />
        <MiniStat label="Favorito"       value={stats.favorite_service ?? '-'} />
      </div>
      <p className="text-xs font-semibold text-gray-400 uppercase">Servicios</p>
      {appointments.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Sin registros</p>
      ) : (
        <div className="space-y-2">
          {appointments.map((a) => <AptRow key={a.id} a={a} />)}
        </div>
      )}
    </div>
  );
}

// ─── CustomerHistory ──────────────────────────────────────────────────────────

interface CustomerHistoryProps {
  data: CustomerData;
  onVehicleClick(plate: string): void;
}

function CustomerHistory({ data, onVehicleClick }: CustomerHistoryProps) {
  const { customer, vehicles, stats, appointments } = data;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">{customer.first_name} {customer.last_name}</h2>
          <a
            href={`tel:${customer.phone}`}
            className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-800 hover:border-gray-300 px-3 py-1.5 rounded-lg text-xs font-medium"
          >
            <Phone aria-hidden="true" size={14} strokeWidth={1.8} />
            Llamar
          </a>
        </div>
        <p className="text-sm text-gray-500">
          {customer.phone}
          {customer.email && ` · ${customer.email}`}
        </p>
        {customer.document_number && (
          <p className="text-xs text-gray-400 mt-1">
            {customer.document_type}: {customer.document_number}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Visitas"        value={stats.total_visits} />
        <MiniStat label="Total gastado"  value={formatCOP(stats.total_spent)} />
        <MiniStat label="Vehículos"      value={stats.vehicle_count} />
        <MiniStat label="Última visita"  value={stats.last_visit ? formatDate(stats.last_visit) : '-'} />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Vehículos</p>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {vehicles.map((v) => (
            <button
              key={v.id}
              onClick={() => onVehicleClick(v.plate)}
              className="shrink-0 bg-white rounded-xl border border-gray-100 px-4 py-3 text-left hover:shadow-sm transition"
            >
              <Placa placa={v.plate} />
              <p className="text-xs text-gray-500">{v.brand} {v.model}</p>
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs font-semibold text-gray-400 uppercase">Servicios</p>
      {appointments.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Sin registros</p>
      ) : (
        <div className="space-y-2">
          {appointments.map((a) => <AptRow key={a.id} a={a} showPlate />)}
        </div>
      )}
    </div>
  );
}

// ─── AptRow ───────────────────────────────────────────────────────────────────

interface AptRowProps {
  a: ApiAppointment;
  showPlate?: boolean;
}

function AptRow({ a, showPlate }: AptRowProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          {showPlate && a.plate && (
            <Placa placa={a.plate} className="!text-xs" />
          )}
          <PastillaEstado status={a.status} />
          <span className="text-xs text-gray-400">{formatDate(a.scheduled_date)}</span>
        </div>
        <p className="text-sm text-gray-700">{a.service_name}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-semibold text-sm">{formatCOP(a.paid_amount ?? a.price ?? 0)}</p>
        {a.payment_method && <p className="text-xs text-gray-400">{a.payment_method}</p>}
      </div>
    </div>
  );
}

// ─── MiniStat ─────────────────────────────────────────────────────────────────

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="font-semibold text-gray-900 text-sm">{value}</p>
    </div>
  );
}