import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useToast, ConfirmDialog } from '../components/ui';

export default function CustomersPage() {
  const toast = useToast();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState({ total: 0, page: 1 });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [formData, setFormData] = useState({ firstName: '', lastName: '', phone: '', email: '', documentNumber: '', notes: '' });

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pagination.page, limit: 20 });
      if (search) params.set('search', search);
      const data = await api(`/customers?${params}`);
      setCustomers(data.data);
      setPagination(p => ({ ...p, total: data.pagination.total }));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search, pagination.page]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // Debounced search
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPagination(p => ({ ...p, page: 1 }));
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const openNew = () => {
    setEditingId(null);
    setFormData({ firstName: '', lastName: '', phone: '', email: '', documentNumber: '', notes: '' });
    setShowForm(true);
  };

  const openEdit = (c) => {
    setEditingId(c.id);
    setFormData({
      firstName: c.first_name, lastName: c.last_name || '',
      phone: c.phone, email: c.email || '',
      documentNumber: c.document_number || '', notes: c.notes || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      if (editingId) {
        await api(`/customers/${editingId}`, { method: 'PATCH', body: formData });
      } else {
        await api('/customers', { method: 'POST', body: formData });
      }
      setShowForm(false);
      toast.success(editingId ? 'Cliente actualizado' : 'Cliente creado');
      fetchCustomers();
    } catch (err) { toast.error(err.message); }
  };

  const confirmDelete = async () => {
    const id = deleteId;
    setDeleteId(null);
    try {
      await api(`/customers/${id}`, { method: 'DELETE' });
      toast.success('Cliente eliminado');
      fetchCustomers();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">Clientes</h1>
        <button onClick={openNew}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
          + Nuevo cliente
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Buscar por nombre, teléfono, placa o cédula..."
        className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none"
      />

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="bg-white rounded-xl p-4 h-20 animate-pulse" />)}
        </div>
      ) : customers.length === 0 ? (
        <div className="text-center py-16">
          <span className="text-5xl block mb-4">👥</span>
          <p className="text-gray-500">{search ? 'No se encontraron resultados' : 'Aún no hay clientes registrados'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {customers.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-gray-900">
                  {c.first_name} {c.last_name}
                  {c.vehicle_count > 0 && (
                    <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                      {c.vehicle_count} vehículo{c.vehicle_count > 1 ? 's' : ''}
                    </span>
                  )}
                </p>
                <p className="text-sm text-gray-500">{c.phone} {c.email ? `· ${c.email}` : ''}</p>
                {c.visit_count > 0 && (
                  <p className="text-xs text-gray-400">{c.visit_count} visitas</p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => openEdit(c)}
                  className="text-xs text-brand-600 hover:text-brand-800 px-2 py-1 rounded transition">
                  Editar
                </button>
                <button onClick={() => setDeleteId(c.id)}
                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded transition">
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.total > 20 && (
        <div className="flex justify-center gap-2 pt-2">
          <button disabled={pagination.page <= 1}
            onClick={() => setPagination(p => ({...p, page: p.page - 1}))}
            className="text-sm px-3 py-1.5 rounded-lg border disabled:opacity-30">← Anterior</button>
          <span className="text-sm text-gray-500 py-1.5">
            Página {pagination.page} de {Math.ceil(pagination.total / 20)}
          </span>
          <button disabled={pagination.page >= Math.ceil(pagination.total / 20)}
            onClick={() => setPagination(p => ({...p, page: p.page + 1}))}
            className="text-sm px-3 py-1.5 rounded-lg border disabled:opacity-30">Siguiente →</button>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowForm(false)} />
          <div className="relative bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-gray-900">{editingId ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-2xl">&times;</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormInput label="Nombre *" value={formData.firstName}
                onChange={v => setFormData(f => ({...f, firstName: v}))} autoFocus />
              <FormInput label="Apellido" value={formData.lastName}
                onChange={v => setFormData(f => ({...f, lastName: v}))} />
            </div>
            <FormInput label="Teléfono *" value={formData.phone} type="tel"
              onChange={v => setFormData(f => ({...f, phone: v}))} placeholder="3001234567" />
            <FormInput label="Email" value={formData.email} type="email"
              onChange={v => setFormData(f => ({...f, email: v}))} />
            <FormInput label="Cédula / NIT" value={formData.documentNumber}
              onChange={v => setFormData(f => ({...f, documentNumber: v}))} />
            <FormInput label="Notas" value={formData.notes}
              onChange={v => setFormData(f => ({...f, notes: v}))} placeholder="Preferencias del cliente..." />

            <button onClick={handleSave}
              className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition text-sm">
              {editingId ? 'Guardar cambios' : 'Crear cliente'}
            </button>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {deleteId && (
        <ConfirmDialog
          title="Eliminar cliente"
          message="Esta acción no se puede deshacer. ¿Seguro que quieres eliminar este cliente?"
          confirmLabel="Eliminar"
          danger
          onCancel={() => setDeleteId(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

function FormInput({ label, value, onChange, type = 'text', placeholder, autoFocus }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} autoFocus={autoFocus}
        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
    </div>
  );
}
