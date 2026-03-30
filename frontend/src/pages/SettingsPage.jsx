import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { formatCOP } from '../lib/format';

const TABS = [
  { key: 'general', label: 'General', icon: '🏪' },
  { key: 'services', label: 'Servicios', icon: '🧽' },
  { key: 'team', label: 'Equipo', icon: '👥' },
];

export default function SettingsPage() {
  const [tab, setTab] = useState('general');

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Configuración</h1>

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
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'general' && <GeneralTab />}
      {tab === 'services' && <ServicesTab />}
      {tab === 'team' && <TeamTab />}
    </div>
  );
}

// ==========================================================================
// General Tab - Lavadero config
// ==========================================================================
function GeneralTab() {
  const [tenant, setTenant] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api('/tenants/me').then(setTenant).catch(console.error);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await api('/tenants/me', {
        method: 'PATCH',
        body: {
          name: tenant.name,
          nit: tenant.nit,
          owner_name: tenant.owner_name,
          phone: tenant.phone,
          email: tenant.email,
          address: tenant.address,
          city: tenant.city,
          opening_time: tenant.opening_time,
          closing_time: tenant.closing_time,
          bays_count: parseInt(tenant.bays_count),
        },
      });
      setTenant(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { alert(err.message); }
    finally { setSaving(false); }
  };

  if (!tenant) return <LoadingBlock />;

  const set = (key, val) => setTenant(t => ({ ...t, [key]: val }));

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-5">
      <SectionTitle>Datos del lavadero</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Nombre del lavadero" value={tenant.name} onChange={v => set('name', v)} />
        <Field label="NIT" value={tenant.nit || ''} onChange={v => set('nit', v)} placeholder="900123456-7" />
        <Field label="Razón social" value={tenant.owner_name || ''} onChange={v => set('owner_name', v)} />
        <Field label="Teléfono" value={tenant.phone || ''} onChange={v => set('phone', v)} />
        <Field label="Email" value={tenant.email || ''} onChange={v => set('email', v)} type="email" />
        <Field label="Ciudad" value={tenant.city || ''} onChange={v => set('city', v)} />
      </div>
      <Field label="Dirección" value={tenant.address || ''} onChange={v => set('address', v)} full />

      <SectionTitle>Operación</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Hora apertura" value={tenant.opening_time || '07:00'} onChange={v => set('opening_time', v)} type="time" />
        <Field label="Hora cierre" value={tenant.closing_time || '19:00'} onChange={v => set('closing_time', v)} type="time" />
        <Field label="Número de bahías" value={tenant.bays_count || 3} onChange={v => set('bays_count', v)} type="number" />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button onClick={handleSave} disabled={saving}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition disabled:opacity-50">
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
        {saved && <span className="text-green-600 text-sm font-medium">Guardado correctamente</span>}
      </div>
    </div>
  );
}

// ==========================================================================
// Services Tab - Catálogo de servicios
// ==========================================================================
function ServicesTab() {
  const [services, setServices] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyServiceForm());

  const fetchServices = useCallback(() => {
    api('/services?all=true').then(setServices).catch(console.error);
  }, []);

  useEffect(() => { fetchServices(); }, [fetchServices]);

  function emptyServiceForm() {
    return { name: '', description: '', priceStedan: '', priceSuv: '', priceCamioneta: '', priceMoto: '', pricePickup: '', estimatedMinutes: 60, sortOrder: 0 };
  }

  const openNew = () => { setEditing(null); setForm(emptyServiceForm()); setShowForm(true); };

  const openEdit = (s) => {
    setEditing(s.id);
    setForm({
      name: s.name, description: s.description || '',
      priceStedan: s.price_sedan / 100, priceSuv: s.price_suv / 100,
      priceCamioneta: s.price_camioneta / 100, priceMoto: s.price_moto / 100,
      pricePickup: s.price_pickup / 100,
      estimatedMinutes: s.estimated_minutes, sortOrder: s.sort_order,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      const body = {
        name: form.name,
        description: form.description,
        priceStedan: Math.round(parseFloat(form.priceStedan || 0) * 100),
        priceSuv: Math.round(parseFloat(form.priceSuv || 0) * 100),
        priceCamioneta: Math.round(parseFloat(form.priceCamioneta || 0) * 100),
        priceMoto: Math.round(parseFloat(form.priceMoto || 0) * 100),
        pricePickup: Math.round(parseFloat(form.pricePickup || 0) * 100),
        estimatedMinutes: parseInt(form.estimatedMinutes) || 60,
        sortOrder: parseInt(form.sortOrder) || 0,
      };
      if (editing) {
        await api(`/services/${editing}`, { method: 'PATCH', body });
      } else {
        await api('/services', { method: 'POST', body });
      }
      setShowForm(false);
      fetchServices();
    } catch (err) { alert(err.message); }
  };

  const handleToggle = async (id) => {
    await api(`/services/${id}/toggle`, { method: 'PATCH' });
    fetchServices();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{services.length} servicios</p>
        <button onClick={openNew}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
          + Nuevo servicio
        </button>
      </div>

      <div className="space-y-2">
        {services.map(s => (
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
                <button onClick={() => openEdit(s)} className="text-xs text-brand-600 hover:text-brand-800 px-2 py-1">Editar</button>
                <button onClick={() => handleToggle(s.id)}
                  className={`text-xs px-2 py-1 ${s.is_active ? 'text-orange-500' : 'text-green-600'}`}>
                  {s.is_active ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Service form modal */}
      {showForm && (
        <Modal title={editing ? 'Editar Servicio' : 'Nuevo Servicio'} onClose={() => setShowForm(false)}>
          <Field label="Nombre *" value={form.name} onChange={v => setForm(f => ({...f, name: v}))} autoFocus />
          <Field label="Descripción" value={form.description} onChange={v => setForm(f => ({...f, description: v}))} />

          <SectionTitle>Precios (en pesos COP, sin centavos)</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Sedán" value={form.priceStedan} onChange={v => setForm(f => ({...f, priceStedan: v}))} type="number" placeholder="25000" />
            <Field label="SUV" value={form.priceSuv} onChange={v => setForm(f => ({...f, priceSuv: v}))} type="number" placeholder="35000" />
            <Field label="Camioneta" value={form.priceCamioneta} onChange={v => setForm(f => ({...f, priceCamioneta: v}))} type="number" />
            <Field label="Pickup" value={form.pricePickup} onChange={v => setForm(f => ({...f, pricePickup: v}))} type="number" />
            <Field label="Moto" value={form.priceMoto} onChange={v => setForm(f => ({...f, priceMoto: v}))} type="number" />
            <Field label="Duración (min)" value={form.estimatedMinutes} onChange={v => setForm(f => ({...f, estimatedMinutes: v}))} type="number" />
          </div>

          <button onClick={handleSave}
            className="w-full mt-4 py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition text-sm">
            {editing ? 'Guardar cambios' : 'Crear servicio'}
          </button>
        </Modal>
      )}
    </div>
  );
}

// ==========================================================================
// Team Tab - Operator management
// ==========================================================================
function TeamTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '', role: 'operator' });

  const fetchUsers = useCallback(() => {
    api('/users').then(setUsers).catch(console.error);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const openNew = () => {
    setEditing(null);
    setForm({ firstName: '', lastName: '', email: '', phone: '', password: '', role: 'operator' });
    setShowForm(true);
  };

  const openEdit = (u) => {
    setEditing(u.id);
    setForm({ firstName: u.first_name, lastName: u.last_name || '', email: u.email, phone: u.phone || '', password: '', role: u.role });
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        const body = { firstName: form.firstName, lastName: form.lastName, phone: form.phone, email: form.email, role: form.role };
        await api(`/users/${editing}`, { method: 'PATCH', body });
        // If password provided, change it
        if (form.password) {
          await api(`/users/${editing}/password`, { method: 'PATCH', body: { newPassword: form.password } });
        }
      } else {
        if (!form.password) { alert('La contraseña es requerida'); return; }
        await api('/users', { method: 'POST', body: form });
      }
      setShowForm(false);
      fetchUsers();
    } catch (err) { alert(err.message); }
  };

  const handleToggle = async (id) => {
    try {
      await api(`/users/${id}/toggle`, { method: 'PATCH' });
      fetchUsers();
    } catch (err) { alert(err.message); }
  };

  const roleLabel = { admin: 'Administrador', operator: 'Operador', super_admin: 'Super Admin' };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{users.length} miembros del equipo</p>
        <button onClick={openNew}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
          + Nuevo operador
        </button>
      </div>

      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className={`bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-3 ${!u.is_active ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm shrink-0">
                {u.first_name[0]}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm text-gray-900">{u.first_name} {u.last_name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {roleLabel[u.role] || u.role}
                  </span>
                  {!u.is_active && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">Inactivo</span>}
                </div>
                <p className="text-xs text-gray-500">{u.email} {u.phone ? `· ${u.phone}` : ''}</p>
                {u.last_login_at && (
                  <p className="text-xs text-gray-400">Último acceso: {new Date(u.last_login_at).toLocaleDateString('es-CO')}</p>
                )}
              </div>
            </div>

            {u.id !== currentUser.id && (
              <div className="flex gap-2 shrink-0">
                <button onClick={() => openEdit(u)} className="text-xs text-brand-600 hover:text-brand-800 px-2 py-1">Editar</button>
                <button onClick={() => handleToggle(u.id)}
                  className={`text-xs px-2 py-1 ${u.is_active ? 'text-orange-500' : 'text-green-600'}`}>
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
            <Field label="Nombre *" value={form.firstName} onChange={v => setForm(f => ({...f, firstName: v}))} autoFocus />
            <Field label="Apellido" value={form.lastName} onChange={v => setForm(f => ({...f, lastName: v}))} />
          </div>
          <Field label="Email *" value={form.email} onChange={v => setForm(f => ({...f, email: v}))} type="email" />
          <Field label="Teléfono" value={form.phone} onChange={v => setForm(f => ({...f, phone: v}))} />
          <Field label={editing ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña *'}
            value={form.password} onChange={v => setForm(f => ({...f, password: v}))} type="password" />

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rol</label>
            <select value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white">
              <option value="operator">Operador</option>
              <option value="admin">Administrador</option>
            </select>
          </div>

          <button onClick={handleSave}
            className="w-full mt-4 py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition text-sm">
            {editing ? 'Guardar cambios' : 'Crear operador'}
          </button>
        </Modal>
      )}
    </div>
  );
}

// ==========================================================================
// Shared UI components
// ==========================================================================
function Field({ label, value, onChange, type = 'text', placeholder, autoFocus, full }) {
  return (
    <div className={full ? 'col-span-full' : ''}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoFocus={autoFocus}
        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
    </div>
  );
}

function SectionTitle({ children }) {
  return <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">{children}</p>;
}

function LoadingBlock() {
  return <div className="bg-white rounded-xl p-8 h-48 animate-pulse" />;
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}
