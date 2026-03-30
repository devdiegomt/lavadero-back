import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatCOP } from '../lib/format';

const VEHICLE_TYPES = [
  { value: 'sedan', label: 'Sedán' },
  { value: 'suv', label: 'SUV' },
  { value: 'camioneta', label: 'Camioneta' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'moto', label: 'Moto' },
];

export default function QuickTurnModal({ onClose, onCreated }) {
  const [step, setStep] = useState(1); // 1: plate, 2: customer+vehicle, 3: service, 4: confirm
  const [services, setServices] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form data
  const [plate, setPlate] = useState('');
  const [existingVehicle, setExistingVehicle] = useState(null);
  const [form, setForm] = useState({
    customerPhone: '',
    customerFirstName: '',
    customerLastName: '',
    vehicleType: 'sedan',
    brand: '',
    model: '',
    color: '',
    serviceId: '',
    assignedTo: '',
    bayNumber: '',
    scheduledTime: '',
    notes: '',
  });

  // Load services on mount
  useEffect(() => {
    api('/services').then(setServices).catch(console.error);
  }, []);

  // Step 1: Search by plate
  const handlePlateSearch = async () => {
    if (!plate.trim()) return;
    setError('');
    setLoading(true);

    try {
      const vehicle = await api(`/vehicles/plate/${plate.trim()}`);
      setExistingVehicle(vehicle);
      setForm(f => ({
        ...f,
        customerPhone: vehicle.customer_phone || '',
        customerFirstName: vehicle.customer_first_name || '',
        customerLastName: vehicle.customer_last_name || '',
        vehicleType: vehicle.vehicle_type || 'sedan',
        brand: vehicle.brand || '',
        model: vehicle.model || '',
        color: vehicle.color || '',
      }));
      setStep(3); // Skip to service selection if vehicle found
    } catch (err) {
      if (err.status === 404) {
        setExistingVehicle(null);
        setStep(2); // Go to create customer+vehicle
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Get selected service price for display
  const getSelectedServicePrice = () => {
    const svc = services.find(s => s.id === form.serviceId);
    if (!svc) return 0;
    const vType = existingVehicle?.vehicle_type || form.vehicleType;
    return svc[`price_${vType}`] || svc.price_sedan || 0;
  };

  // Submit
  const handleSubmit = async () => {
    setError('');
    setLoading(true);

    try {
      await api('/appointments/quick', {
        method: 'POST',
        body: {
          customerPhone: form.customerPhone,
          customerFirstName: form.customerFirstName,
          customerLastName: form.customerLastName,
          plate: plate.toUpperCase().trim(),
          vehicleType: form.vehicleType,
          brand: form.brand,
          model: form.model,
          color: form.color,
          serviceId: form.serviceId,
          assignedTo: form.assignedTo || undefined,
          bayNumber: form.bayNumber ? parseInt(form.bayNumber) : undefined,
          scheduledTime: form.scheduledTime || undefined,
          notes: form.notes || undefined,
        },
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div>
            <h2 className="font-bold text-gray-900">Nuevo Turno</h2>
            <p className="text-xs text-gray-500">Paso {step} de 4</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>
          )}

          {/* STEP 1: Plate search */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <span className="text-4xl">🚗</span>
                <p className="text-gray-500 text-sm mt-2">Ingresa la placa del vehículo</p>
              </div>
              <input
                type="text"
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handlePlateSearch()}
                placeholder="ABC123"
                autoFocus
                maxLength={7}
                className="w-full text-center text-3xl font-bold tracking-widest px-4 py-4 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none uppercase"
              />
              <button
                onClick={handlePlateSearch}
                disabled={!plate.trim() || loading}
                className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition disabled:opacity-50"
              >
                {loading ? 'Buscando...' : 'Buscar placa'}
              </button>
            </div>
          )}

          {/* STEP 2: Customer + Vehicle info (new vehicle) */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="bg-yellow-50 text-yellow-800 text-sm px-4 py-3 rounded-lg">
                Vehículo <strong>{plate}</strong> no encontrado. Registra los datos:
              </div>

              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Datos del cliente</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Nombre *" value={form.customerFirstName}
                  onChange={(v) => setForm(f => ({...f, customerFirstName: v}))} autoFocus />
                <Input label="Apellido" value={form.customerLastName}
                  onChange={(v) => setForm(f => ({...f, customerLastName: v}))} />
              </div>
              <Input label="Teléfono *" value={form.customerPhone} type="tel"
                onChange={(v) => setForm(f => ({...f, customerPhone: v}))} placeholder="3001234567" />

              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-2">Datos del vehículo</p>
              <Select label="Tipo" value={form.vehicleType}
                onChange={(v) => setForm(f => ({...f, vehicleType: v}))}
                options={VEHICLE_TYPES} />
              <div className="grid grid-cols-3 gap-3">
                <Input label="Marca" value={form.brand}
                  onChange={(v) => setForm(f => ({...f, brand: v}))} placeholder="Chevrolet" />
                <Input label="Modelo" value={form.model}
                  onChange={(v) => setForm(f => ({...f, model: v}))} placeholder="Spark" />
                <Input label="Color" value={form.color}
                  onChange={(v) => setForm(f => ({...f, color: v}))} placeholder="Blanco" />
              </div>

              <button
                onClick={() => {
                  if (!form.customerFirstName || !form.customerPhone) {
                    setError('Nombre y teléfono del cliente son requeridos');
                    return;
                  }
                  setError('');
                  setStep(3);
                }}
                className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition"
              >
                Siguiente
              </button>
            </div>
          )}

          {/* STEP 3: Service selection */}
          {step === 3 && (
            <div className="space-y-4">
              {existingVehicle && (
                <div className="bg-green-50 text-green-800 text-sm px-4 py-3 rounded-lg">
                  <strong>{plate}</strong> — {existingVehicle.brand} {existingVehicle.model} ({existingVehicle.color})
                  <br />
                  <span className="text-green-600">Cliente: {existingVehicle.customer_first_name} {existingVehicle.customer_last_name} — {existingVehicle.customer_phone}</span>
                </div>
              )}

              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Selecciona el servicio</p>
              <div className="space-y-2">
                {services.map((svc) => {
                  const vType = existingVehicle?.vehicle_type || form.vehicleType;
                  const price = svc[`price_${vType}`] || svc.price_sedan;
                  const selected = form.serviceId === svc.id;
                  return (
                    <button
                      key={svc.id}
                      onClick={() => setForm(f => ({...f, serviceId: svc.id}))}
                      className={`w-full text-left p-4 rounded-xl border-2 transition ${
                        selected ? 'border-brand-500 bg-brand-50' : 'border-gray-100 hover:border-gray-200'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="font-semibold text-sm text-gray-900">{svc.name}</p>
                          <p className="text-xs text-gray-500">{svc.description} · ~{svc.estimated_minutes} min</p>
                        </div>
                        <p className="font-bold text-brand-700 text-sm">{formatCOP(price)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => {
                  if (!form.serviceId) { setError('Selecciona un servicio'); return; }
                  setError('');
                  setStep(4);
                }}
                disabled={!form.serviceId}
                className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          )}

          {/* STEP 4: Confirm + optional details */}
          {step === 4 && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <SummaryRow label="Placa" value={plate} />
                <SummaryRow label="Cliente" value={`${form.customerFirstName} ${form.customerLastName} — ${form.customerPhone}`} />
                <SummaryRow label="Vehículo" value={`${form.brand || ''} ${form.model || ''} (${existingVehicle?.vehicle_type || form.vehicleType})`} />
                <SummaryRow label="Servicio" value={services.find(s => s.id === form.serviceId)?.name} />
                <SummaryRow label="Precio" value={formatCOP(getSelectedServicePrice())} bold />
              </div>

              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Detalles opcionales</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Hora" type="time" value={form.scheduledTime}
                  onChange={(v) => setForm(f => ({...f, scheduledTime: v}))} />
                <Input label="Bahía" type="number" value={form.bayNumber}
                  onChange={(v) => setForm(f => ({...f, bayNumber: v}))} placeholder="1" />
              </div>
              <Input label="Notas" value={form.notes}
                onChange={(v) => setForm(f => ({...f, notes: v}))} placeholder="Ej: Cera extra, rayón en puerta..." />

              <button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition disabled:opacity-50 text-sm"
              >
                {loading ? 'Creando turno...' : `Crear turno — ${formatCOP(getSelectedServicePrice())}`}
              </button>
            </div>
          )}

          {/* Back button */}
          {step > 1 && (
            <button
              onClick={() => { setError(''); setStep(step - 1); }}
              className="w-full py-2.5 text-sm text-gray-500 hover:text-gray-700 transition"
            >
              ← Volver
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Reusable input component
function Input({ label, value, onChange, type = 'text', placeholder, autoFocus }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
      />
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function SummaryRow({ label, value, bold }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`text-gray-900 ${bold ? 'font-bold' : ''}`}>{value}</span>
    </div>
  );
}
