import { useState, type Dispatch, type SetStateAction, type HTMLInputTypeAttribute } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

interface BusinessData {
  businessName: string;
  nit: string;
  ownerName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  openingTime: string;
  closingTime: string;
  baysCount: number | string;
}

interface AdminData {
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminPassword: string;
  confirmPassword: string;
}

interface ServiceDraft {
  name: string;
  description: string;
  priceSedan: number | string;
  priceSuv: number | string;
  priceMoto: number | string;
  estimatedMinutes: number | string;
}

interface StepDef { num: Step; label: string }

const STEPS: StepDef[] = [
  { num: 1, label: 'Lavadero' },
  { num: 2, label: 'Tu cuenta' },
  { num: 3, label: 'Servicios' },
];

const DEFAULT_SERVICES: ServiceDraft[] = [
  { name: 'Lavado Básico',    description: 'Exterior con agua, jabón y secado',                 priceSedan: 25000, priceSuv: 35000, priceMoto: 15000, estimatedMinutes: 30 },
  { name: 'Lavado Completo',  description: 'Exterior + interior: aspirado, tablero, vidrios',   priceSedan: 40000, priceSuv: 55000, priceMoto: 25000, estimatedMinutes: 60 },
  { name: 'Lavado Premium',   description: 'Completo + encerado + protector de llantas',        priceSedan: 60000, priceSuv: 75000, priceMoto: 40000, estimatedMinutes: 90 },
];

// ─── SignupPage ───────────────────────────────────────────────────────────────

export default function SignupPage() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [step, setStep]             = useState<Step>(1);
  const [error, setError]           = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Wizard data
  const [business, setBusiness] = useState<BusinessData>({
    businessName: '', nit: '', ownerName: '', phone: '', email: '',
    address: '', city: 'Bogotá',
    openingTime: '07:00', closingTime: '19:00', baysCount: 3,
  });
  const [admin, setAdmin] = useState<AdminData>({
    adminFirstName: '', adminLastName: '', adminEmail: '',
    adminPassword: '', confirmPassword: '',
  });
  const [services, setServices] = useState<ServiceDraft[]>(DEFAULT_SERVICES);

  // Step 1 → Step 2
  const validateBusiness = (): string | null => {
    if (!business.businessName.trim()) return 'El nombre del lavadero es requerido';
    if (business.businessName.trim().length < 3) return 'El nombre debe tener al menos 3 caracteres';
    if (!business.phone.trim() || business.phone.trim().length < 7) return 'Ingresa un teléfono válido';
    const bays = typeof business.baysCount === 'string' ? parseInt(business.baysCount, 10) : business.baysCount;
    if (bays < 1 || bays > 20) return 'El número de bahías debe ser entre 1 y 20';
    return null;
  };

  const goToAdmin = () => {
    const err = validateBusiness();
    if (err) { setError(err); return; }
    setError('');
    setStep(2);
  };

  // Step 2 → Crear cuenta
  const validateAdmin = (): string | null => {
    if (!admin.adminFirstName.trim()) return 'Tu nombre es requerido';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.adminEmail)) return 'Email inválido';
    if (admin.adminPassword.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
    if (admin.adminPassword !== admin.confirmPassword) return 'Las contraseñas no coinciden';
    return null;
  };

  const handleRegister = async () => {
    const err = validateAdmin();
    if (err) { setError(err); return; }
    setError('');
    setSubmitting(true);

    try {
      await signup({
        businessName: business.businessName.trim(),
        nit:          business.nit.trim() || null,
        ownerName:    business.ownerName.trim() || null,
        phone:        business.phone.trim(),
        email:        business.email.trim() || null,
        address:      business.address.trim() || null,
        city:         business.city.trim() || 'Bogotá',
        openingTime:  business.openingTime,
        closingTime:  business.closingTime,
        baysCount:    parseInt(String(business.baysCount), 10) || 3,
        adminEmail:     admin.adminEmail.trim().toLowerCase(),
        adminPassword:  admin.adminPassword,
        adminFirstName: admin.adminFirstName.trim(),
        adminLastName:  admin.adminLastName.trim() || null,
      });
      setStep(3);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409) {
          setError('Ya existe una cuenta con ese email. ¿Quieres iniciar sesión?');
        } else if ((e.data as { validation?: { message: string }[] } | null)?.validation) {
          const validation = (e.data as { validation: { message: string }[] }).validation;
          setError(validation.map((v) => v.message).join('. '));
        } else {
          setError(e.message || 'No se pudo crear la cuenta');
        }
      } else {
        setError((e as Error).message || 'No se pudo crear la cuenta');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Step 3 → Crear servicios + complete
  const handleFinish = async (useDefaults: boolean) => {
    setSubmitting(true);
    setError('');
    try {
      const body = useDefaults
        ? { services: [] }
        : {
            services: services.map((s) => ({
              name: s.name,
              description: s.description,
              priceSedan:      Math.round(parseFloat(String(s.priceSedan || 0)) * 100),
              priceSuv:        Math.round(parseFloat(String(s.priceSuv || 0)) * 100),
              priceCamioneta:  Math.round(parseFloat(String(s.priceSuv || 0)) * 100),
              priceMoto:       Math.round(parseFloat(String(s.priceMoto || 0)) * 100),
              pricePickup:     Math.round(parseFloat(String(s.priceSuv || 0)) * 100),
              estimatedMinutes: parseInt(String(s.estimatedMinutes), 10) || 60,
            })),
          };

      await api('/onboarding/services', { method: 'POST', body });
      await api('/onboarding/complete',  { method: 'POST' });
      navigate('/');
    } catch (e) {
      setError((e as Error).message || 'No se pudo guardar la configuración');
    } finally {
      setSubmitting(false);
    }
  };

  // Step 3 helpers
  const updateService = <K extends keyof ServiceDraft>(idx: number, key: K, val: ServiceDraft[K]) =>
    setServices((arr) => arr.map((s, i) => (i === idx ? { ...s, [key]: val } : s)));

  const addService = () =>
    setServices((arr) => [...arr, { name: '', description: '', priceSedan: 0, priceSuv: 0, priceMoto: 0, estimatedMinutes: 60 }]);

  const removeService = (idx: number) =>
    setServices((arr) => arr.filter((_, i) => i !== idx));

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-700 to-brand-900 px-4 py-8">
      <div className="max-w-xl mx-auto">
        {/* Brand */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-white/10 rounded-2xl mb-3">
            <span className="text-2xl">🚿</span>
          </div>
          <h1 className="text-xl font-bold text-white">Crea tu cuenta</h1>
          <p className="text-brand-200 text-sm mt-1">Pon tu lavadero a operar en 2 minutos</p>
        </div>

        {/* Stepper */}
        <Stepper currentStep={step} />

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
              {error}
              {error.includes('iniciar sesión') && (
                <Link to="/login" className="ml-2 font-semibold underline">Ir al login</Link>
              )}
            </div>
          )}

          {step === 1 && <BusinessStep value={business} onChange={setBusiness} onNext={goToAdmin} />}

          {step === 2 && (
            <AdminStep
              value={admin}
              onChange={setAdmin}
              onBack={() => setStep(1)}
              onSubmit={handleRegister}
              submitting={submitting}
            />
          )}

          {step === 3 && (
            <ServicesStep
              services={services}
              onUpdate={updateService}
              onAdd={addService}
              onRemove={removeService}
              onFinish={handleFinish}
              submitting={submitting}
            />
          )}
        </div>

        {/* Footer link */}
        {step === 1 && (
          <p className="text-center text-brand-300 text-xs mt-6">
            ¿Ya tienes cuenta?{' '}
            <Link to="/login" className="text-white hover:underline font-medium">
              Inicia sesión
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({ currentStep }: { currentStep: Step }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {STEPS.map((s, idx) => {
        const isDone   = currentStep > s.num;
        const isActive = currentStep === s.num;
        return (
          <div key={s.num} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition ${
                  isDone ? 'bg-green-500 text-white' :
                  isActive ? 'bg-white text-brand-700' :
                  'bg-white/20 text-white/60'
                }`}
              >
                {isDone ? '✓' : s.num}
              </div>
              <span className={`text-xs mt-1.5 ${isActive ? 'text-white font-semibold' : 'text-white/60'}`}>
                {s.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`w-10 h-0.5 mx-2 mb-5 transition ${isDone ? 'bg-green-500' : 'bg-white/20'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── BusinessStep ─────────────────────────────────────────────────────────────

interface BusinessStepProps {
  value: BusinessData;
  onChange: Dispatch<SetStateAction<BusinessData>>;
  onNext(): void;
}

function BusinessStep({ value, onChange, onNext }: BusinessStepProps) {
  const set = <K extends keyof BusinessData>(key: K, val: BusinessData[K]) =>
    onChange((b) => ({ ...b, [key]: val }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-gray-900">Datos del lavadero</h2>
        <p className="text-xs text-gray-500 mt-0.5">Información básica de tu negocio.</p>
      </div>

      <Field label="Nombre del lavadero *" value={value.businessName} onChange={(v) => set('businessName', v)}
        placeholder="El Brillante" autoFocus />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="NIT (opcional)" value={value.nit} onChange={(v) => set('nit', v)} placeholder="900123456-7" />
        <Field label="Razón social (opcional)" value={value.ownerName} onChange={(v) => set('ownerName', v)}
          placeholder="Inversiones El Brillante S.A.S." />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Teléfono *" value={value.phone} onChange={(v) => set('phone', v)} placeholder="3001234567" type="tel" />
        <Field label="Ciudad" value={value.city} onChange={(v) => set('city', v)} placeholder="Bogotá" />
      </div>

      <Field label="Dirección (opcional)" value={value.address} onChange={(v) => set('address', v)} placeholder="Cra. 7 #45-12" />

      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2">Operación</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Apertura" value={value.openingTime} onChange={(v) => set('openingTime', v)} type="time" />
          <Field label="Cierre"   value={value.closingTime} onChange={(v) => set('closingTime', v)} type="time" />
          <Field label="Bahías"   value={String(value.baysCount)} onChange={(v) => set('baysCount', v)} type="number" min={1} max={20} />
        </div>
      </div>

      <div className="pt-2">
        <button onClick={onNext}
          className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition text-sm">
          Continuar →
        </button>
      </div>
    </div>
  );
}

// ─── AdminStep ────────────────────────────────────────────────────────────────

interface AdminStepProps {
  value: AdminData;
  onChange: Dispatch<SetStateAction<AdminData>>;
  onBack(): void;
  onSubmit(): void;
  submitting: boolean;
}

function AdminStep({ value, onChange, onBack, onSubmit, submitting }: AdminStepProps) {
  const set = <K extends keyof AdminData>(key: K, val: AdminData[K]) =>
    onChange((a) => ({ ...a, [key]: val }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-gray-900">Tu cuenta de administrador</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Con esta cuenta entrarás al sistema. Podrás invitar a tus operadores después.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nombre *" value={value.adminFirstName} onChange={(v) => set('adminFirstName', v)} placeholder="Diego" autoFocus />
        <Field label="Apellido" value={value.adminLastName}  onChange={(v) => set('adminLastName', v)} placeholder="Torres" />
      </div>

      <Field label="Email *" value={value.adminEmail} onChange={(v) => set('adminEmail', v)}
        placeholder="diego@elbrillante.co" type="email" autoComplete="email" />

      <Field label="Contraseña *" value={value.adminPassword} onChange={(v) => set('adminPassword', v)}
        type="password" placeholder="Mínimo 8 caracteres" autoComplete="new-password" />

      <Field label="Confirma contraseña *" value={value.confirmPassword} onChange={(v) => set('confirmPassword', v)}
        type="password" placeholder="Repite la contraseña" autoComplete="new-password" />

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
        🎁 Tu cuenta empieza en el plan <strong>Gratis</strong> con 14 días de prueba en funciones avanzadas.
        Sin tarjeta de crédito.
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} disabled={submitting}
          className="flex-1 py-3 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition text-sm disabled:opacity-50">
          ← Atrás
        </button>
        <button onClick={onSubmit} disabled={submitting}
          className="flex-1 py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition text-sm disabled:opacity-50">
          {submitting ? 'Creando cuenta...' : 'Crear cuenta'}
        </button>
      </div>
    </div>
  );
}

// ─── ServicesStep ─────────────────────────────────────────────────────────────

interface ServicesStepProps {
  services: ServiceDraft[];
  onUpdate<K extends keyof ServiceDraft>(idx: number, key: K, val: ServiceDraft[K]): void;
  onAdd(): void;
  onRemove(idx: number): void;
  onFinish(useDefaults: boolean): void;
  submitting: boolean;
}

function ServicesStep({ services, onUpdate, onAdd, onRemove, onFinish, submitting }: ServicesStepProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-gray-900">Configura tus servicios</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Estos son los lavados que ofreces. Puedes ajustar precios o saltarte este paso (luego los configuras desde Settings).
        </p>
      </div>

      <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
        {services.map((s, idx) => (
          <div key={idx} className="border border-gray-200 rounded-xl p-3 space-y-2 bg-gray-50/50">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <input
                  value={s.name}
                  onChange={(e) => onUpdate(idx, 'name', e.target.value)}
                  placeholder="Nombre del servicio"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-semibold focus:ring-2 focus:ring-brand-500 outline-none bg-white"
                />
                <input
                  value={s.description}
                  onChange={(e) => onUpdate(idx, 'description', e.target.value)}
                  placeholder="Descripción (opcional)"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-600 focus:ring-2 focus:ring-brand-500 outline-none bg-white"
                />
              </div>
              {services.length > 1 && (
                <button onClick={() => onRemove(idx)}
                  className="text-gray-400 hover:text-red-600 text-lg p-1 transition shrink-0"
                  title="Eliminar servicio">
                  ✕
                </button>
              )}
            </div>

            <div className="grid grid-cols-4 gap-2">
              <PriceField label="Sedán" value={s.priceSedan} onChange={(v) => onUpdate(idx, 'priceSedan', v)} />
              <PriceField label="SUV"   value={s.priceSuv}   onChange={(v) => onUpdate(idx, 'priceSuv', v)} />
              <PriceField label="Moto"  value={s.priceMoto}  onChange={(v) => onUpdate(idx, 'priceMoto', v)} />
              <div>
                <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Min</label>
                <input
                  title="Tiempo estimado en minutos"
                  type="number"
                  value={s.estimatedMinutes}
                  onChange={(e) => onUpdate(idx, 'estimatedMinutes', e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-brand-500 outline-none bg-white"
                  min={5}
                  max={600}
                />
              </div>
            </div>
          </div>
        ))}

        <button onClick={onAdd}
          className="w-full py-2 border-2 border-dashed border-gray-200 hover:border-brand-300 text-gray-500 hover:text-brand-600 text-sm font-medium rounded-xl transition">
          + Agregar otro servicio
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-gray-100">
        <button onClick={() => onFinish(true)} disabled={submitting}
          className="flex-1 py-3 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition text-sm disabled:opacity-50">
          Saltar y usar servicios sugeridos
        </button>
        <button onClick={() => onFinish(false)} disabled={submitting}
          className="flex-1 py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition text-sm disabled:opacity-50">
          {submitting ? 'Guardando...' : 'Crear y entrar al sistema'}
        </button>
      </div>
    </div>
  );
}

// ─── Form fields ──────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: string;
  onChange(v: string): void;
  type?: HTMLInputTypeAttribute;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
  min?: number;
  max?: number;
}

function Field({ label, value, onChange, type = 'text', placeholder, autoFocus, autoComplete, min, max }: FieldProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        min={min}
        max={max}
        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none transition"
      />
    </div>
  );
}

interface PriceFieldProps {
  label: string;
  value: number | string;
  onChange(v: string): void;
}

function PriceField({ label, value, onChange }: PriceFieldProps) {
  return (
    <div>
      <label className="block text-[10px] font-medium text-gray-500 mb-0.5">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        min={0}
        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-brand-500 outline-none bg-white"
      />
    </div>
  );
}