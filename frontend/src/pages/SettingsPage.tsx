import { useState, useEffect, useCallback, type HTMLInputTypeAttribute, type ReactNode } from 'react';
import { Check, Copy, ExternalLink, Gem, Minus, Sparkles, Store, Users, X, type LucideIcon } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { CONTACTO_VENTAS, useSuscripcion, type Metrica } from '../lib/suscripcion';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { formatCOP } from '../lib/format';
import { useToast } from '../components/ui';
import type { UserRole } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'general' | 'services' | 'team' | 'plan';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  nit: string | null;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  opening_time: string | null;
  closing_time: string | null;
  bays_count: number;
}

interface Service {
  id: string;
  name: string;
  description: string | null;
  price_sedan: number;
  price_suv: number;
  price_camioneta: number;
  price_moto: number;
  price_pickup: number;
  estimated_minutes: number;
  sort_order: number;
  is_active: boolean;
}

interface User {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  last_login_at: string | null;
}

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: 'general',  label: 'General',   icon: Store },
  { key: 'services', label: 'Servicios', icon: Sparkles },
  { key: 'team',     label: 'Equipo',    icon: Users },
  { key: 'plan',     label: 'Plan',      icon: Gem },
];

const esTab = (v: string | null): v is Tab => TABS.some((t) => t.key === v);

// ─── SettingsPage ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
  // La pestaña va en la URL (?tab=plan): así el aviso de prueba puede llevar
  // directo a la de planes.
  const [params, setParams] = useSearchParams();
  const pedida = params.get('tab');
  const tab: Tab = esTab(pedida) ? pedida : 'general';
  const setTab = (t: Tab) => setParams(t === 'general' ? {} : { tab: t }, { replace: true });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Configuración</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            // En el celular sólo se ve el ícono (el texto va `hidden sm:inline`):
            // sin esto el botón no tiene nombre y un lector de pantalla dice
            // «botón» a secas. Lo encontró la prueba de la pestaña Plan.
            aria-label={t.label}
            aria-pressed={tab === t.key}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon aria-hidden="true" size={16} strokeWidth={1.6} />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'general'  && <GeneralTab />}
      {tab === 'services' && <ServicesTab />}
      {tab === 'team'     && <TeamTab />}
      {tab === 'plan'     && <PlanTab />}
    </div>
  );
}

// ─── General Tab — Lavadero config ────────────────────────────────────────────

function GeneralTab() {
  const toast = useToast();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  useEffect(() => {
    api<Tenant>('/tenants/me').then(setTenant).catch(console.error);
  }, []);

  const handleSave = async () => {
    if (!tenant) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await api<Tenant>('/tenants/me', {
        method: 'PATCH',
        body: {
          name:         tenant.name,
          nit:          tenant.nit,
          owner_name:   tenant.owner_name,
          phone:        tenant.phone,
          email:        tenant.email,
          address:      tenant.address,
          city:         tenant.city,
          opening_time: tenant.opening_time,
          closing_time: tenant.closing_time,
          bays_count:   typeof tenant.bays_count === 'string' ? parseInt(tenant.bays_count, 10) : tenant.bays_count,
        },
      });
      setTenant(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!tenant) return <LoadingBlock />;

  const set = <K extends keyof Tenant>(key: K, val: Tenant[K]) =>
    setTenant((t) => (t ? { ...t, [key]: val } : t));

  return (
    <div className="space-y-5">
    <EnlaceReservas slug={tenant.slug} />
    <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-5">
      <SectionTitle>Datos del lavadero</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Nombre del lavadero" value={tenant.name}             onChange={(v) => set('name', v)} />
        <Field label="NIT"                 value={tenant.nit ?? ''}        onChange={(v) => set('nit', v)} placeholder="900123456-7" />
        <Field label="Razón social"        value={tenant.owner_name ?? ''} onChange={(v) => set('owner_name', v)} />
        <Field label="Teléfono"            value={tenant.phone ?? ''}      onChange={(v) => set('phone', v)} />
        <Field label="Email"               value={tenant.email ?? ''}      onChange={(v) => set('email', v)} type="email" />
        <Field label="Ciudad"              value={tenant.city ?? ''}       onChange={(v) => set('city', v)} />
      </div>
      <Field label="Dirección" value={tenant.address ?? ''} onChange={(v) => set('address', v)} full />

      <SectionTitle>Operación</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Hora apertura"     value={tenant.opening_time ?? '07:00'}   onChange={(v) => set('opening_time', v)} type="time" />
        <Field label="Hora cierre"       value={tenant.closing_time ?? '19:00'}   onChange={(v) => set('closing_time', v)} type="time" />
        <Field label="Número de bahías"  value={String(tenant.bays_count ?? 3)}   onChange={(v) => set('bays_count', parseInt(v, 10) || 3)} type="number" />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition disabled:opacity-50"
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
        {saved && <span className="text-green-600 text-sm font-medium">Guardado correctamente</span>}
      </div>
    </div>
    </div>
  );
}

/**
 * El enlace a la página de reservas, para que el dueño lo copie a su Instagram,
 * su WhatsApp o un QR. Los horarios que ofrece salen de «Operación», abajo, y de
 * las bahías: si hay que cambiarlos, es ahí.
 */
function EnlaceReservas({ slug }: { slug: string }) {
  const toast = useToast();
  const url = `${window.location.origin}/reservar/${slug}`;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Enlace copiado');
    } catch {
      toast.error('No se pudo copiar. Selecciónalo y cópialo a mano.');
    }
  };
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
      <SectionTitle>Página de reservas</SectionTitle>
      <p className="text-sm text-gray-600">
        Tus clientes reservan aquí sin descargar nada. Comparte el enlace en tu Instagram, tu WhatsApp o un código QR en
        el mostrador; las reservas aparecen en la agenda.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <code className="flex-1 min-w-0 truncate px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900" data-testid="enlace-reservas">
          {url}
        </code>
        <div className="flex gap-2">
          <button type="button" onClick={copiar} className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg transition">
            <Copy size={16} aria-hidden="true" /> Copiar
          </button>
          <a href={url} target="_blank" rel="noopener" className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-800 text-sm font-semibold rounded-lg hover:bg-gray-100 transition">
            <ExternalLink size={16} aria-hidden="true" /> Abrir
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Services Tab — Catálogo de servicios ────────────────────────────────────

interface ServiceForm {
  name: string;
  description: string;
  priceSedan:     string;
  priceSuv:       string;
  priceCamioneta: string;
  priceMoto:      string;
  pricePickup:    string;
  estimatedMinutes: number | string;
  sortOrder:        number | string;
}

const emptyServiceForm = (): ServiceForm => ({
  name: '', description: '',
  priceSedan: '', priceSuv: '', priceCamioneta: '', priceMoto: '', pricePickup: '',
  estimatedMinutes: 60, sortOrder: 0,
});

function ServicesTab() {
  const toast = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<string | null>(null);
  const [form, setForm]         = useState<ServiceForm>(emptyServiceForm);

  const fetchServices = useCallback(() => {
    api<Service[]>('/services?all=true').then(setServices).catch(console.error);
  }, []);

  useEffect(() => { fetchServices(); }, [fetchServices]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyServiceForm());
    setShowForm(true);
  };

  const openEdit = (s: Service) => {
    setEditing(s.id);
    setForm({
      name:        s.name,
      description: s.description ?? '',
      priceSedan:     String(s.price_sedan / 100),
      priceSuv:       String(s.price_suv / 100),
      priceCamioneta: String(s.price_camioneta / 100),
      priceMoto:      String(s.price_moto / 100),
      pricePickup:    String(s.price_pickup / 100),
      estimatedMinutes: s.estimated_minutes,
      sortOrder:        s.sort_order,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      const body = {
        name:        form.name,
        description: form.description,
        priceSedan:     Math.round(parseFloat(form.priceSedan     || '0') * 100),
        priceSuv:       Math.round(parseFloat(form.priceSuv       || '0') * 100),
        priceCamioneta: Math.round(parseFloat(form.priceCamioneta || '0') * 100),
        priceMoto:      Math.round(parseFloat(form.priceMoto      || '0') * 100),
        pricePickup:    Math.round(parseFloat(form.pricePickup    || '0') * 100),
        estimatedMinutes: parseInt(String(form.estimatedMinutes), 10) || 60,
        sortOrder:        parseInt(String(form.sortOrder), 10) || 0,
      };
      if (editing) {
        await api(`/services/${editing}`, { method: 'PATCH', body });
      } else {
        await api('/services', { method: 'POST', body });
      }
      setShowForm(false);
      fetchServices();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleToggle = async (id: string) => {
    await api(`/services/${id}/toggle`, { method: 'PATCH' });
    fetchServices();
  };

  const set = <K extends keyof ServiceForm>(key: K, val: ServiceForm[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{services.length} servicios</p>
        <button
          onClick={openNew}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          + Nuevo servicio
        </button>
      </div>

      <div className="space-y-2">
        {services.map((s) => (
          <div key={s.id} className={`bg-white rounded-xl border border-gray-100 p-4 ${!s.is_active ? 'opacity-50' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm text-gray-900">{s.name}</p>
                  {!s.is_active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">Inactivo</span>}
                </div>
                {s.description && <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-400">
                  <span>Sedán: {formatCOP(s.price_sedan)}</span>
                  <span>SUV: {formatCOP(s.price_suv)}</span>
                  <span>Moto: {formatCOP(s.price_moto)}</span>
                  <span>~{s.estimated_minutes} min</span>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => openEdit(s)} className="text-xs text-brand-600 hover:text-brand-800 px-2 py-1">
                  Editar
                </button>
                <button
                  onClick={() => handleToggle(s.id)}
                  className={`text-xs px-2 py-1 ${s.is_active ? 'text-orange-700' : 'text-green-600'}`}
                >
                  {s.is_active ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <Modal title={editing ? 'Editar Servicio' : 'Nuevo Servicio'} onClose={() => setShowForm(false)}>
          <Field label="Nombre *"   value={form.name}        onChange={(v) => set('name', v)} autoFocus />
          <Field label="Descripción" value={form.description} onChange={(v) => set('description', v)} />

          <SectionTitle>Precios (en pesos COP, sin centavos)</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Sedán"     value={form.priceSedan}     onChange={(v) => set('priceSedan', v)}     type="number" placeholder="25000" />
            <Field label="SUV"       value={form.priceSuv}       onChange={(v) => set('priceSuv', v)}       type="number" placeholder="35000" />
            <Field label="Camioneta" value={form.priceCamioneta} onChange={(v) => set('priceCamioneta', v)} type="number" />
            <Field label="Pickup"    value={form.pricePickup}    onChange={(v) => set('pricePickup', v)}    type="number" />
            <Field label="Moto"      value={form.priceMoto}      onChange={(v) => set('priceMoto', v)}      type="number" />
            <Field label="Duración (min)" value={String(form.estimatedMinutes)} onChange={(v) => set('estimatedMinutes', v)} type="number" />
          </div>

          <button
            onClick={handleSave}
            className="w-full mt-4 py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition text-sm"
          >
            {editing ? 'Guardar cambios' : 'Crear servicio'}
          </button>
        </Modal>
      )}
    </div>
  );
}

// ─── Team Tab — Operator management ──────────────────────────────────────────

interface UserForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  role: UserRole;
}

const emptyUserForm = (): UserForm => ({
  firstName: '', lastName: '', email: '', phone: '', password: '', role: 'operator',
});

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  super_admin: 'Super Admin',
};

function TeamTab() {
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const [users, setUsers]     = useState<User[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm]       = useState<UserForm>(emptyUserForm);

  const fetchUsers = useCallback(() => {
    api<User[]>('/users').then(setUsers).catch(console.error);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyUserForm());
    setShowForm(true);
  };

  const openEdit = (u: User) => {
    setEditing(u.id);
    setForm({
      firstName: u.first_name,
      lastName:  u.last_name ?? '',
      email:     u.email,
      phone:     u.phone ?? '',
      password:  '',
      role:      u.role,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        const body = {
          firstName: form.firstName,
          lastName:  form.lastName,
          phone:     form.phone,
          email:     form.email,
          role:      form.role,
        };
        await api(`/users/${editing}`, { method: 'PATCH', body });
        if (form.password) {
          await api(`/users/${editing}/password`, { method: 'PATCH', body: { newPassword: form.password } });
        }
      } else {
        if (!form.password) { toast.error('La contraseña es requerida'); return; }
        await api('/users', { method: 'POST', body: form });
      }
      setShowForm(false);
      fetchUsers();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await api(`/users/${id}/toggle`, { method: 'PATCH' });
      fetchUsers();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const set = <K extends keyof UserForm>(key: K, val: UserForm[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{users.length} miembros del equipo</p>
        <button
          onClick={openNew}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          + Nuevo operador
        </button>
      </div>

      <div className="space-y-2">
        {users.map((u) => (
          <div
            key={u.id}
            className={`bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-3 ${!u.is_active ? 'opacity-50' : ''}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-semibold text-sm shrink-0">
                {u.first_name[0]}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm text-gray-900">{u.first_name} {u.last_name}</p>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {ROLE_LABEL[u.role] ?? u.role}
                  </span>
                  {!u.is_active && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">Inactivo</span>}
                </div>
                <p className="text-xs text-gray-500">{u.email} {u.phone ? `· ${u.phone}` : ''}</p>
                {u.last_login_at && (
                  <p className="text-xs text-gray-400">
                    Último acceso: {new Date(u.last_login_at).toLocaleDateString('es-CO')}
                  </p>
                )}
              </div>
            </div>

            {currentUser && u.id !== currentUser.id && (
              <div className="flex gap-2 shrink-0">
                <button onClick={() => openEdit(u)} className="text-xs text-brand-600 hover:text-brand-800 px-2 py-1">
                  Editar
                </button>
                <button
                  onClick={() => handleToggle(u.id)}
                  className={`text-xs px-2 py-1 ${u.is_active ? 'text-orange-700' : 'text-green-600'}`}
                >
                  {u.is_active ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {showForm && (
        <Modal title={editing ? 'Editar Usuario' : 'Nuevo Operador'} onClose={() => setShowForm(false)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre *" value={form.firstName} onChange={(v) => set('firstName', v)} autoFocus />
            <Field label="Apellido" value={form.lastName}  onChange={(v) => set('lastName', v)} />
          </div>
          <Field label="Email *"   value={form.email} onChange={(v) => set('email', v)} type="email" />
          <Field label="Teléfono"  value={form.phone} onChange={(v) => set('phone', v)} />
          <Field
            label={editing ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña *'}
            value={form.password}
            onChange={(v) => set('password', v)}
            type="password"
          />

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rol</label>
            <select
              value={form.role}
              onChange={(e) => set('role', e.target.value as UserRole)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white"
              title="Seleccionar el rol del usuario"
            >
              <option value="operator">Operador</option>
              <option value="admin">Administrador</option>
            </select>
          </div>

          <button
            onClick={handleSave}
            className="w-full mt-4 py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition text-sm"
          >
            {editing ? 'Guardar cambios' : 'Crear operador'}
          </button>
        </Modal>
      )}
    </div>
  );
}

// ─── Shared UI components ────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: string;
  onChange(v: string): void;
  type?: HTMLInputTypeAttribute;
  placeholder?: string;
  autoFocus?: boolean;
  full?: boolean;
}

function Field({ label, value, onChange, type = 'text', placeholder, autoFocus, full }: FieldProps) {
  return (
    <div className={full ? 'col-span-full' : ''}>
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

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">{children}</p>;
}

function LoadingBlock() {
  return <div className="bg-white rounded-xl p-8 h-48 animate-pulse" />;
}

interface ModalProps {
  title: string;
  onClose(): void;
  children: ReactNode;
}

function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl" aria-label="Cerrar"><X aria-hidden="true" size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
// ─── Plan Tab ─────────────────────────────────────────────────────────────────

const ESTADO: Record<'trial' | 'active' | 'suspended', string> = {
  trial: 'En prueba',
  active: 'Activo',
  suspended: 'Suspendido',
};

function PlanTab() {
  const s = useSuscripcion();
  if (!s) return <div className="h-48 bg-white border border-gray-100 rounded-xl animate-pulse" />;

  const { plan, subscription: sub, usage, availablePlans } = s;
  const conDescuento = plan.priceWithDiscount < plan.priceMonthly;
  const ofrecido = availablePlans.some((p) => p.id === plan.id);

  return (
    <div className="space-y-6">
      {/* Plan actual */}
      <section className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="etiqueta text-gray-500">Tu plan</p>
            <h2 className="text-2xl font-semibold text-gray-900 mt-1">{plan.name}</h2>
            {!ofrecido && (
              <p className="text-xs text-gray-500 mt-1">Este plan ya no se ofrece; lo conservas mientras quieras.</p>
            )}
          </div>
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded ${
              sub.readOnly ? 'bg-red-100 text-red-800' : sub.status === 'trial' ? 'bg-brand-100 text-brand-800' : 'bg-green-100 text-green-800'
            }`}
          >
            {sub.readOnly && sub.status === 'trial' ? 'Prueba terminada' : ESTADO[sub.status]}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <p className="etiqueta text-gray-500">Mensualidad</p>
            <p className="cifra text-xl font-semibold text-gray-900 mt-1">
              {formatCOP(plan.priceWithDiscount)}
              {conDescuento && (
                <span className="ml-2 text-sm font-normal text-gray-500 line-through">{formatCOP(plan.priceMonthly)}</span>
              )}
            </p>
            {conDescuento && (
              <p className="text-xs text-brand-700 mt-1">
                Precio fundador: {sub.discountPct}% menos
                {sub.discountUntil ? ` hasta el ${new Date(sub.discountUntil + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.
              </p>
            )}
          </div>
          {sub.status === 'trial' && (sub.trialDaysLeft !== null || sub.readOnly) && (
            <div>
              <p className="etiqueta text-gray-500">Prueba</p>
              <p className="cifra text-xl font-semibold text-gray-900 mt-1">
                {sub.readOnly ? 'Terminó' : sub.trialDaysLeft === 1 ? 'Último día' : `${sub.trialDaysLeft} días`}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {sub.readOnly
                  ? 'Puedes ver todos tus datos; para registrar cambios, elige un plan.'
                  : 'Con todo lo de Estudio Pro. Al terminar no se borra nada.'}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3 pt-1">
          <Uso label="Operarios" m={usage.operators} />
          <Uso label="Servicios activos" m={usage.services} />
          <Uso label="Turnos este mes" m={usage.appointments} />
        </div>
      </section>

      {/* Comparativa */}
      <section className="space-y-3">
        <h3 className="text-base font-semibold text-gray-900">Planes</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {availablePlans.map((p) => (
            <div
              key={p.id}
              className={`bg-white rounded-xl border p-5 space-y-4 ${p.id === plan.id ? 'border-brand-600' : 'border-gray-100'}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="font-semibold text-gray-900">{p.name}</h4>
                {p.id === plan.id && <span className="etiqueta text-brand-700">Tu plan</span>}
              </div>
              <p className="cifra text-2xl font-semibold text-gray-900">
                {formatCOP(p.priceMonthly)}
                <span className="text-sm font-normal text-gray-500"> / mes</span>
              </p>
              <ul className="space-y-1.5 text-sm">
                <Incluye si>{p.maxOperators === null ? 'Operarios sin límite' : `Hasta ${p.maxOperators} operarios`}</Incluye>
                <Incluye si>Turnos sin límite</Incluye>
                <Incluye si={p.reports}>Reportes</Incluye>
                <Incluye si={p.billing}>Facturación electrónica</Incluye>
                <Incluye si={p.whatsapp}>Bot de WhatsApp</Incluye>
              </ul>
            </div>
          ))}
        </div>
        <p className="text-sm text-gray-500">
          Para elegir o cambiar de plan,{' '}
          {CONTACTO_VENTAS ? (
            <a href={CONTACTO_VENTAS} target="_blank" rel="noopener" className="text-brand-700 font-semibold underline underline-offset-2">
              escríbenos
            </a>
          ) : (
            'escríbenos'
          )}
          . Pronto se podrá pagar con tarjeta desde acá.
        </p>
      </section>
    </div>
  );
}

function Uso({ label, m }: { label: string; m: Metrica }) {
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-gray-600">{label}</span>
        <span className="font-mono text-gray-900">
          {m.current}
          <span className="text-gray-500">{m.limit === null ? ' · sin límite' : ` de ${m.limit}`}</span>
        </span>
      </div>
      {m.limit !== null && (
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1.5">
          <div
            className={`h-full rounded-full ${(m.pct ?? 0) >= 90 ? 'bg-red-600' : 'bg-brand-600'}`}
            style={{ width: `${Math.min(m.pct ?? 0, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Incluye({ si, children }: { si: boolean; children: ReactNode }) {
  const Icono = si ? Check : Minus;
  return (
    <li className={`flex items-center gap-2 ${si ? 'text-gray-800' : 'text-gray-400'}`}>
      <Icono aria-hidden="true" size={15} strokeWidth={2} className={si ? 'text-green-600' : 'text-gray-300'} />
      <span>{children}</span>
      <span className="sr-only">{si ? '(incluido)' : '(no incluido)'}</span>
    </li>
  );
}
