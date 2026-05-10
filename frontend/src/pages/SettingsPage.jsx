import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { formatCOP } from '../lib/format';
import { useToast } from '../components/ui';

const TABS = [
  { key: 'general',   label: 'General',     icon: '🏪' },
  { key: 'services',  label: 'Servicios',   icon: '🧽' },
  { key: 'team',      label: 'Equipo',      icon: '👥' },
  { key: 'billing',   label: 'Facturación', icon: '🧾' },
  { key: 'whatsapp',  label: 'WhatsApp',    icon: '💬' },
  { key: 'plan',      label: 'Plan',        icon: '⭐' },
];

export default function SettingsPage() {
  const [tab, setTab] = useState('general');

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Configuración</h1>

      {/* Tabs — scroll horizontal en mobile, todas visibles en desktop */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 min-w-[80px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-medium transition whitespace-nowrap ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>{t.icon}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'general'  && <GeneralTab />}
      {tab === 'services' && <ServicesTab />}
      {tab === 'team'     && <TeamTab />}
      {tab === 'billing'  && <BillingTab />}
      {tab === 'whatsapp' && <WhatsAppTab />}
      {tab === 'plan'     && <PlanTab />}
    </div>
  );
}

// ==========================================================================
// General Tab - Lavadero config
// ==========================================================================
function GeneralTab() {
  const toast = useToast();
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
    } catch (err) { toast.error(err.message); }
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
  const toast = useToast();
  const [services, setServices] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyServiceForm());

  const fetchServices = useCallback(() => {
    api('/services?all=true').then(setServices).catch(console.error);
  }, []);

  useEffect(() => { fetchServices(); }, [fetchServices]);

  function emptyServiceForm() {
    return { name: '', description: '', priceSedan: '', priceSuv: '', priceCamioneta: '', priceMoto: '', pricePickup: '', estimatedMinutes: 60, sortOrder: 0 };
  }

  const openNew = () => { setEditing(null); setForm(emptyServiceForm()); setShowForm(true); };

  const openEdit = (s) => {
    setEditing(s.id);
    setForm({
      name: s.name, description: s.description || '',
      priceSedan: s.price_sedan / 100, priceSuv: s.price_suv / 100,
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
        priceSedan: Math.round(parseFloat(form.priceSedan || 0) * 100),
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
    } catch (err) { toast.error(err.message); }
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
            <Field label="Sedán" value={form.priceSedan} onChange={v => setForm(f => ({...f, priceSedan: v}))} type="number" placeholder="25000" />
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
  const toast = useToast();
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
        if (!form.password) { toast.error('La contraseña es requerida'); return; }
        await api('/users', { method: 'POST', body: form });
      }
      setShowForm(false);
      fetchUsers();
    } catch (err) { toast.error(err.message); }
  };

  const handleToggle = async (id) => {
    try {
      await api(`/users/${id}/toggle`, { method: 'PATCH' });
      fetchUsers();
    } catch (err) { toast.error(err.message); }
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
// Billing Tab - Configuración fiscal (Alegra/DIAN)
// ==========================================================================
function BillingTab() {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    provider: '', apiKey: '', resolution: '', prefix: '', nit: '',
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/billing/config');
      setConfig(data);
      setForm({
        provider:   data.provider   || '',
        apiKey:     '', // nunca se devuelve la real, solo se sobreescribe si se llena
        resolution: data.resolution || '',
        prefix:     data.prefix     || '',
        nit:        data.nit        || '',
      });
    } catch (err) {
      if (err.status === 403) {
        toast.error('Tu plan actual no incluye facturación. Actualiza al plan Básico o Pro.');
      } else {
        toast.error(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Solo enviamos apiKey si tiene valor (para no borrar la guardada)
      const body = {
        provider:   form.provider,
        resolution: form.resolution,
        prefix:     form.prefix,
        nit:        form.nit,
      };
      if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();

      const updated = await api('/billing/config', { method: 'PATCH', body });
      setConfig(updated);
      setForm(f => ({ ...f, apiKey: '' })); // limpiar campo después de guardar
      toast.success?.('Configuración guardada');
    } catch (err) {
      toast.error(err.message);
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api('/billing/config/test', { method: 'POST' });
      setTestResult({ ok: true, ...result });
    } catch (err) {
      setTestResult({ ok: false, error: err.message, hint: err.data?.hint });
    } finally { setTesting(false); }
  };

  const handleSync = async () => {
    if (!confirm('¿Sincronizar todos los servicios activos con Alegra? Los servicios nuevos se crearán y los existentes se actualizarán.')) return;
    setSyncing(true);
    try {
      const result = await api('/billing/sync-services', { method: 'POST' });
      toast.success?.(result.message);
    } catch (err) {
      toast.error(err.message);
    } finally { setSyncing(false); }
  };

  if (loading) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      {/* Status card */}
      <div className={`rounded-xl border p-5 ${
        config?.connectionOk
          ? 'bg-green-50 border-green-200'
          : config?.isConfigured
            ? 'bg-yellow-50 border-yellow-200'
            : 'bg-gray-50 border-gray-200'
      }`}>
        <div className="flex items-start gap-3">
          <span className="text-2xl">
            {config?.connectionOk ? '✅' : config?.isConfigured ? '⚠️' : '⚙️'}
          </span>
          <div className="flex-1">
            <p className="font-semibold text-sm text-gray-900">
              {config?.connectionOk
                ? 'Facturación electrónica activa'
                : config?.isConfigured
                  ? 'Configurado pero sin conexión'
                  : 'No configurado'}
            </p>
            <p className="text-xs text-gray-600 mt-1">
              {config?.connectionOk
                ? `Conectado a ${config.provider === 'alegra' ? 'Alegra' : config.provider}. Las facturas se emitirán automáticamente al registrar pagos.`
                : config?.isConfigured
                  ? 'Las credenciales no están funcionando. Verifica el API key con "Probar conexión".'
                  : 'Configura tu proveedor de facturación electrónica para emitir facturas con CUFE válido ante la DIAN.'}
            </p>
            {config?.companyName && config?.connectionOk && (
              <p className="text-xs text-gray-500 mt-2">
                Empresa registrada: <strong>{config.companyName}</strong>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-5">
        <SectionTitle>Datos fiscales</SectionTitle>
        <Field label="NIT" value={form.nit} onChange={v => setForm(f => ({...f, nit: v}))} placeholder="900123456-7" />

        <SectionTitle>Proveedor de facturación</SectionTitle>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Proveedor</label>
          <select value={form.provider} onChange={e => setForm(f => ({...f, provider: e.target.value}))}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white">
            <option value="">— Selecciona un proveedor —</option>
            <option value="alegra">Alegra (recomendado)</option>
            <option value="siigo">Siigo</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            API Key {config?.isConfigured && <span className="text-gray-400">(actual: ••••••••, deja vacío para no cambiar)</span>}
          </label>
          <input
            type="password"
            value={form.apiKey}
            onChange={e => setForm(f => ({...f, apiKey: e.target.value}))}
            placeholder="email@empresa.com:tu-token-aqui"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none font-mono"
          />
          <p className="text-xs text-gray-500 mt-1">
            Para Alegra: formato <code className="bg-gray-100 px-1 rounded">email:token</code>. Obtén el token en
            {' '}<a href="https://app.alegra.com/configuration/api" target="_blank" rel="noopener" className="text-brand-600 underline">Alegra → Configuración → API</a>.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Resolución DIAN" value={form.resolution} onChange={v => setForm(f => ({...f, resolution: v}))} placeholder="18760000001" />
          <Field label="Prefijo de factura" value={form.prefix} onChange={v => setForm(f => ({...f, prefix: v}))} placeholder="FE" />
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button onClick={handleSave} disabled={saving}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar configuración'}
          </button>
          <button onClick={handleTest} disabled={testing || !config?.isConfigured}
            className="border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-semibold px-6 py-2.5 rounded-lg transition disabled:opacity-50">
            {testing ? 'Probando...' : 'Probar conexión'}
          </button>
          <button onClick={handleSync} disabled={syncing || !config?.connectionOk}
            className="border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-semibold px-6 py-2.5 rounded-lg transition disabled:opacity-50">
            {syncing ? 'Sincronizando...' : 'Sincronizar servicios'}
          </button>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`rounded-lg p-4 text-sm ${testResult.ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {testResult.ok ? (
              <div className="space-y-1">
                <p className="font-semibold">✅ {testResult.message}</p>
                {testResult.company && <p className="text-xs">Empresa: {testResult.company.name} ({testResult.company.identification})</p>}
                <p className="text-xs">Templates de numeración: {testResult.numberTemplates} · Impuestos: {testResult.taxes}</p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="font-semibold">❌ {testResult.error}</p>
                {testResult.hint && <p className="text-xs">{testResult.hint}</p>}
              </div>
            )}
          </div>
        )}

        {/* Number templates info */}
        {config?.numberTemplates?.length > 0 && (
          <div className="border-t border-gray-100 pt-4 mt-2">
            <SectionTitle>Resoluciones activas en Alegra</SectionTitle>
            <div className="space-y-2 mt-2">
              {config.numberTemplates.map(nt => (
                <div key={nt.id} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                  <div>
                    <p className="font-medium text-gray-900">{nt.name}</p>
                    <p className="text-xs text-gray-500">Prefijo: {nt.prefix || '—'} · Actual: #{nt.currentNumber || 0}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    nt.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
                  }`}>{nt.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================================================
// WhatsApp Tab - Configuración del bot
// ==========================================================================
function WhatsAppTab() {
  const toast = useToast();
  const [tenant, setTenant] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api('/tenants/me').then(setTenant).catch(console.error);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api('/tenants/me', {
        method: 'PATCH',
        body: {
          whatsapp_enabled: tenant.whatsapp_enabled,
          whatsapp_phone: tenant.whatsapp_phone,
          whatsapp_provider: tenant.whatsapp_provider || 'baileys',
        },
      });
      setTenant(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  if (!tenant) return <LoadingBlock />;

  const set = (key, val) => setTenant(t => ({ ...t, [key]: val }));

  return (
    <div className="space-y-4">
      {/* Info card */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">💡</span>
          <div className="text-sm text-blue-900 space-y-2">
            <p className="font-semibold">Arquitectura del bot</p>
            <p className="text-xs leading-relaxed">
              Tu bot corre con <strong>Baileys</strong> (WhatsApp Web no oficial), orquestado con <strong>n8n</strong> y
              respondiendo con <strong>Claude AI</strong>. Para activarlo necesitas: (1) levantar el contenedor <code className="bg-blue-100 px-1 rounded">bot-wa</code>,
              (2) escanear el QR en los logs (<code className="bg-blue-100 px-1 rounded">docker compose logs -f bot-wa</code>), y (3) importar el workflow en
              <code className="bg-blue-100 px-1 rounded">n8n/workflows/whatsapp-main.json</code>.
            </p>
          </div>
        </div>
      </div>

      {/* Toggle + form */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-5">
        {/* Toggle principal */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-sm text-gray-900">Chatbot WhatsApp</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {tenant.whatsapp_enabled
                ? 'Activado: los clientes pueden consultar estado, agendar y recibir notificaciones.'
                : 'Desactivado: el bot no responderá ni enviará notificaciones automáticas.'}
            </p>
          </div>
          <button
            onClick={() => set('whatsapp_enabled', !tenant.whatsapp_enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition shrink-0 ${
              tenant.whatsapp_enabled ? 'bg-green-500' : 'bg-gray-300'
            }`}
            aria-label="Activar WhatsApp"
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
              tenant.whatsapp_enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        <SectionTitle>Conexión</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Número del lavadero"
            value={tenant.whatsapp_phone || ''}
            onChange={v => set('whatsapp_phone', v)}
            placeholder="+573001234567"
          />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Proveedor</label>
            <select
              value={tenant.whatsapp_provider || 'baileys'}
              onChange={e => set('whatsapp_provider', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white"
            >
              <option value="baileys">Baileys (WhatsApp Web)</option>
              <option value="twilio">Twilio</option>
              <option value="360dialog">360dialog</option>
            </select>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4 space-y-3">
          <SectionTitle>Notificaciones automáticas</SectionTitle>
          <ul className="text-xs text-gray-600 space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>Cuando un vehículo pasa a estado <strong>Listo</strong>, se envía un WhatsApp al cliente.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>Si la cita fue agendada, se envía recordatorio 30 min antes.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>Los clientes pueden escribir al bot para consultar estado, ver precios, agendar.</span>
            </li>
          </ul>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button onClick={handleSave} disabled={saving}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
          {saved && <span className="text-green-600 text-sm font-medium">Guardado correctamente</span>}
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
// Plan Tab - Plan actual + barras de uso
// ==========================================================================
function PlanTab() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/tenants/me/usage')
      .then(setData)
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  if (loading) return <LoadingBlock />;
  if (!data) return null;

  const { plan, usage, features } = data;

  const planColor = {
    free:  { bg: 'bg-gray-50',  border: 'border-gray-200',  badge: 'bg-gray-200 text-gray-700' },
    basic: { bg: 'bg-blue-50',  border: 'border-blue-200',  badge: 'bg-blue-200 text-blue-800' },
    pro:   { bg: 'bg-purple-50', border: 'border-purple-200', badge: 'bg-purple-200 text-purple-800' },
  }[plan.id] || { bg: 'bg-gray-50', border: 'border-gray-200', badge: 'bg-gray-200 text-gray-700' };

  return (
    <div className="space-y-4">
      {/* Plan actual */}
      <div className={`rounded-xl border p-5 ${planColor.bg} ${planColor.border}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Plan actual</p>
            <div className="flex items-center gap-3 mt-1">
              <h2 className="text-2xl font-bold text-gray-900">{plan.name}</h2>
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${planColor.badge}`}>
                {plan.id.toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-gray-600 mt-2">
              {plan.priceMonthly === 0 ? 'Gratis' : `${formatCOP(plan.priceMonthly)} / mes`}
            </p>
          </div>
        </div>
      </div>

      {/* Uso */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-5">
        <SectionTitle>Uso de este mes</SectionTitle>

        <UsageBar label="Turnos del mes"  current={usage.appointments.current} limit={usage.appointments.limit} pct={usage.appointments.pct} />
        <UsageBar label="Operadores"       current={usage.operators.current}    limit={usage.operators.limit}    pct={usage.operators.pct} />
        <UsageBar label="Servicios activos" current={usage.services.current}   limit={usage.services.limit}     pct={usage.services.pct} />
      </div>

      {/* Features */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
        <SectionTitle>Funciones incluidas en tu plan</SectionTitle>
        <div className="space-y-2">
          <FeatureRow label="Chatbot WhatsApp"           enabled={features.whatsapp} note="Notificaciones y agendamiento por WhatsApp" />
          <FeatureRow label="Facturación electrónica DIAN" enabled={features.billing}  note="Emisión de facturas con CUFE vía Alegra" />
          <FeatureRow label="Reportes avanzados"          enabled={features.reports}  note="Ingresos, top servicios, métodos de pago" />
        </div>
      </div>

      {/* Upgrade hint si no es pro */}
      {plan.id !== 'pro' && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-5">
          <p className="font-semibold text-sm text-purple-900">¿Necesitas más capacidad?</p>
          <p className="text-xs text-purple-800 mt-1">
            Actualizar al plan Pro te da 2.000 turnos/mes, 10 operadores, WhatsApp + Facturación incluidos.
            Para cambiar de plan, contacta al administrador del sistema.
          </p>
        </div>
      )}
    </div>
  );
}

function UsageBar({ label, current, limit, pct }) {
  const safe = Math.min(pct, 100);
  const color = safe >= 90 ? 'bg-red-500' : safe >= 70 ? 'bg-yellow-500' : 'bg-brand-500';
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-700 font-medium">{label}</span>
        <span className="text-gray-500">{current} / {limit}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${safe}%` }} />
      </div>
      {pct >= 90 && <p className="text-xs text-red-600 mt-1">Estás cerca del límite. Considera actualizar tu plan.</p>}
    </div>
  );
}

function FeatureRow({ label, enabled, note }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`text-lg shrink-0 ${enabled ? 'text-green-500' : 'text-gray-300'}`}>
        {enabled ? '✓' : '✕'}
      </span>
      <div className="flex-1">
        <p className={`text-sm font-medium ${enabled ? 'text-gray-900' : 'text-gray-400'}`}>{label}</p>
        <p className="text-xs text-gray-500">{note}</p>
      </div>
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