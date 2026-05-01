import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatCOP, formatDate } from '../lib/format';
import { EmptyState, useToast } from '../components/ui';

const STATUS_LABEL = { pending: 'Esperando', in_progress: 'Lavando', done: 'Listo', delivered: 'Entregado', cancelled: 'Cancelado' };
const STATUS_COLOR = { pending: 'bg-gray-100 text-gray-600', in_progress: 'bg-yellow-100 text-yellow-700', done: 'bg-green-100 text-green-700', delivered: 'bg-blue-100 text-blue-700', cancelled: 'bg-red-100 text-red-600' };

export default function HistoryPage() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [vehicleData, setVehicleData] = useState(null);
  const [customerData, setCustomerData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('search');

  useEffect(() => {
    if (query.length < 2) { setSearchResults(null); return; }
    const timer = setTimeout(async () => {
      try { setSearchResults(await api(`/history/search?q=${encodeURIComponent(query)}`)); }
      catch { setSearchResults(null); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const openVehicle = async (plate) => {
    setLoading(true);
    try { setVehicleData(await api(`/history/vehicle/${plate}`)); setView('vehicle'); }
    catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const openCustomer = async (id) => {
    setLoading(true);
    try { setCustomerData(await api(`/history/customer/${id}`)); setView('customer'); }
    catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const goBack = () => { setView('search'); setVehicleData(null); setCustomerData(null); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {view !== 'search' && <button onClick={goBack} className="text-brand-600 hover:text-brand-800 text-sm font-medium">← Volver</button>}
        <h1 className="text-xl font-bold text-gray-900">Historial</h1>
      </div>

      {view === 'search' && (
        <>
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por placa, nombre, teléfono o cédula..."
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none" autoFocus />
          {searchResults ? (
            <div className="space-y-4">
              {searchResults.vehicles.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Vehículos</p>
                  <div className="space-y-2">
                    {searchResults.vehicles.map(v => (
                      <button key={v.id} onClick={() => openVehicle(v.plate)}
                        className="w-full bg-white rounded-xl border border-gray-100 p-4 text-left hover:shadow-sm transition">
                        <div className="flex items-center justify-between">
                          <div><span className="font-bold text-sm tracking-wider">{v.plate}</span><span className="text-gray-400 text-xs ml-2">{v.brand} {v.model}</span></div>
                          <span className="text-brand-600 text-xs">Ver historial →</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{v.customer_first_name} {v.customer_last_name} · {v.customer_phone}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {searchResults.customers.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Clientes</p>
                  <div className="space-y-2">
                    {searchResults.customers.map(c => (
                      <button key={c.id} onClick={() => openCustomer(c.id)}
                        className="w-full bg-white rounded-xl border border-gray-100 p-4 text-left hover:shadow-sm transition">
                        <div className="flex items-center justify-between">
                          <div><span className="font-semibold text-sm">{c.first_name} {c.last_name}</span><span className="text-gray-400 text-xs ml-2">{c.phone}</span></div>
                          <span className="text-brand-600 text-xs">Ver perfil →</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">{c.visit_count} visitas · {c.vehicle_count} vehículo{c.vehicle_count !== 1 ? 's' : ''}</p>
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
            <EmptyState icon="🔍" title="Busca por placa, nombre o teléfono" description="Escribe al menos 2 caracteres para buscar" />
          ) : null}
        </>
      )}

      {view === 'vehicle' && vehicleData && <VehicleHistory data={vehicleData} onCustomerClick={openCustomer} />}
      {view === 'customer' && customerData && <CustomerHistory data={customerData} onVehicleClick={openVehicle} />}
    </div>
  );
}

function VehicleHistory({ data, onCustomerClick }) {
  const { vehicle, customer, stats, appointments } = data;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-3xl font-bold tracking-wider">{vehicle.plate}</span>
          <span className="text-xs bg-brand-100 text-brand-700 px-3 py-1 rounded-lg font-medium">{vehicle.vehicle_type}</span>
        </div>
        <p className="text-sm text-gray-600">{vehicle.brand} {vehicle.model} {vehicle.color && `· ${vehicle.color}`} {vehicle.year && `· ${vehicle.year}`}</p>
        <button onClick={() => onCustomerClick(customer.id)} className="text-sm text-brand-600 mt-2 hover:underline">
          👤 {customer.first_name} {customer.last_name} · {customer.phone}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Visitas" value={stats.completed_visits} />
        <MiniStat label="Total gastado" value={formatCOP(stats.total_spent)} />
        <MiniStat label="Prom. servicio" value={stats.avg_service_minutes ? `${stats.avg_service_minutes} min` : '-'} />
        <MiniStat label="Favorito" value={stats.favorite_service || '-'} />
      </div>
      <p className="text-xs font-semibold text-gray-400 uppercase">Servicios</p>
      {appointments.length === 0 ? <p className="text-sm text-gray-400 text-center py-8">Sin registros</p> : (
        <div className="space-y-2">{appointments.map(a => <AptRow key={a.id} a={a} />)}</div>
      )}
    </div>
  );
}

function CustomerHistory({ data, onVehicleClick }) {
  const { customer, vehicles, stats, appointments } = data;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold">{customer.first_name} {customer.last_name}</h2>
          <a href={`tel:${customer.phone}`} className="bg-green-100 text-green-700 px-3 py-1.5 rounded-lg text-xs font-medium">📞 Llamar</a>
        </div>
        <p className="text-sm text-gray-500">{customer.phone} {customer.email && `· ${customer.email}`}</p>
        {customer.document_number && <p className="text-xs text-gray-400 mt-1">{customer.document_type}: {customer.document_number}</p>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Visitas" value={stats.total_visits} />
        <MiniStat label="Total gastado" value={formatCOP(stats.total_spent)} />
        <MiniStat label="Vehículos" value={stats.vehicle_count} />
        <MiniStat label="Última visita" value={stats.last_visit ? formatDate(stats.last_visit) : '-'} />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Vehículos</p>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {vehicles.map(v => (
            <button key={v.id} onClick={() => onVehicleClick(v.plate)}
              className="shrink-0 bg-white rounded-xl border border-gray-100 px-4 py-3 text-left hover:shadow-sm transition">
              <p className="font-bold text-sm tracking-wider">{v.plate}</p>
              <p className="text-xs text-gray-500">{v.brand} {v.model}</p>
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs font-semibold text-gray-400 uppercase">Servicios</p>
      {appointments.length === 0 ? <p className="text-sm text-gray-400 text-center py-8">Sin registros</p> : (
        <div className="space-y-2">{appointments.map(a => <AptRow key={a.id} a={a} showPlate />)}</div>
      )}
    </div>
  );
}

function AptRow({ a, showPlate }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          {showPlate && <span className="font-bold text-xs tracking-wider text-gray-700">{a.plate}</span>}
          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[a.status]}`}>{STATUS_LABEL[a.status]}</span>
          <span className="text-xs text-gray-400">{formatDate(a.scheduled_date)}</span>
        </div>
        <p className="text-sm text-gray-700">{a.service_name}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-semibold text-sm">{formatCOP(a.paid_amount || a.price)}</p>
        {a.payment_method && <p className="text-xs text-gray-400">{a.payment_method}</p>}
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="font-bold text-gray-900 text-sm">{value}</p>
    </div>
  );
}
