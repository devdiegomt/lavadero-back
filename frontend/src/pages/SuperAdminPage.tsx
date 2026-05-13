import { useState, useEffect, useCallback, type ReactNode } from "react";
import { api } from "../lib/api";
import { formatCOP, formatDateTime } from "../lib/format";
import {
  useToast,
  Badge,
  EmptyState,
  SkeletonCard,
  ConfirmDialog,
  StatCard,
} from "../components/ui";
import type { UserRole } from "../types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "dashboard" | "tenants" | "plans";
type PlanId = "free" | "basic" | "pro";

interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  plan: PlanId;
  email: string | null;
  phone: string | null;
  city: string | null;
  isActive: boolean;
  trialEndsAt: string | null;
  whatsappEnabled: boolean;
  billingProvider: string | null;
  userCount: number;
  todayAppointments: number;
  monthRevenue: number;
  createdAt: string;
}

interface TenantsResponse {
  data: TenantListItem[];
  pagination: { total: number };
}

interface DashboardData {
  overview: {
    activeTenants: number;
    inactiveTenants: number;
    inTrial: number;
    totalUsers: number;
    monthRevenue: number;
    todayAppointments: number;
    monthAppointments: number;
    newTenantsWeek: number;
    newTenantsMonth: number;
  };
  planDistribution: { free: number; basic: number; pro: number };
  topTenants: Array<{
    id: string;
    name: string;
    plan: PlanId;
    appointments: number;
    revenue: number;
  }>;
}

interface TenantUser {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  role: UserRole;
  is_active: boolean;
  last_login_at: string | null;
}

interface TenantStats {
  customers: number;
  vehicles: number;
  total_appointments: number;
  total_payments: number;
  total_revenue: number;
}

interface TenantUsageMetric {
  current: number;
  limit: number;
  pct: number;
}

interface TenantUsage {
  usage: {
    appointments: TenantUsageMetric;
    operators: TenantUsageMetric;
    services: TenantUsageMetric;
  };
}

interface TenantDetailData {
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: PlanId;
    is_active: boolean;
    email: string | null;
    phone: string | null;
    nit: string | null;
    owner_name: string | null;
    city: string | null;
    bays_count: number;
    opening_time: string;
    closing_time: string;
    trial_ends_at: string | null;
    whatsapp_enabled: boolean;
    whatsapp_provider: string | null;
    whatsapp_phone: string | null;
    billing_provider: string | null;
    billing_api_key: string | null;
    billing_resolution: string | null;
    billing_prefix: string | null;
  };
  stats: TenantStats;
  usage: TenantUsage | null;
  users: TenantUser[];
  onboarding: Array<{ step: string; created_at: string }>;
}

interface Plan {
  id: PlanId;
  name: string;
  price_monthly: number; // centavos
  max_operators: number;
  max_appointments_month: number;
  max_services: number;
  max_bays: number;
  whatsapp_enabled: boolean;
  billing_enabled: boolean;
  reports_enabled: boolean;
  tenantCount: number;
}

interface ChangePlanResponse {
  message: string;
}

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "📊" },
  { key: "tenants", label: "Tenants", icon: "🏢" },
  { key: "plans", label: "Planes", icon: "⭐" },
];

const PLAN_COLORS: Record<PlanId, string> = {
  free: "bg-gray-100 text-gray-700",
  basic: "bg-blue-100 text-blue-700",
  pro: "bg-purple-100 text-purple-700",
};

// ─── SuperAdminPage ───────────────────────────────────────────────────────────

export default function SuperAdminPage() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-white border border-gray-200 p-1 rounded-xl">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-medium transition ${
              tab === t.key
                ? "bg-gray-900 text-white shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardTab />}
      {tab === "tenants" && <TenantsTab />}
      {tab === "plans" && <PlansTab />}
    </div>
  );
}

// ─── Dashboard Tab ────────────────────────────────────────────────────────────

function DashboardTab() {
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<DashboardData>("/superadmin/dashboard")
      .then(setData)
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  if (loading) return <SkeletonCard count={6} />;
  if (!data) return null;

  const { overview, planDistribution, topTenants } = data;
  const totalTenants = overview.activeTenants + overview.inactiveTenants;
  const totalPlans =
    planDistribution.free + planDistribution.basic + planDistribution.pro;

  return (
    <div className="space-y-4">
      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Tenants activos"
          value={overview.activeTenants}
          icon="🏢"
          sub={
            overview.inactiveTenants > 0
              ? `${overview.inactiveTenants} inactivos`
              : "todos activos"
          }
        />
        <StatCard
          label="En período de prueba"
          value={overview.inTrial}
          icon="🎁"
          sub="trial activo"
        />
        <StatCard
          label="Usuarios totales"
          value={overview.totalUsers}
          icon="👥"
        />
        <StatCard
          label="Ingresos del mes"
          value={formatCOP(overview.monthRevenue)}
          icon="💰"
          sub="suma de todos los lavaderos"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Citas hoy"
          value={overview.todayAppointments}
          icon="📅"
        />
        <StatCard
          label="Citas del mes"
          value={overview.monthAppointments}
          icon="📆"
        />
        <StatCard
          label="Nuevos esta semana"
          value={overview.newTenantsWeek}
          icon="✨"
        />
        <StatCard
          label="Nuevos del mes"
          value={overview.newTenantsMonth}
          icon="🚀"
        />
      </div>

      {/* Plan distribution */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-bold text-gray-900 mb-4">Distribución por plan</h2>
        <div className="space-y-3">
          <PlanBar
            label="Free"
            count={planDistribution.free}
            total={totalPlans}
            color="bg-gray-400"
          />
          <PlanBar
            label="Basic"
            count={planDistribution.basic}
            total={totalPlans}
            color="bg-blue-500"
          />
          <PlanBar
            label="Pro"
            count={planDistribution.pro}
            total={totalPlans}
            color="bg-purple-500"
          />
        </div>
        {totalTenants > totalPlans && (
          <p className="text-xs text-gray-400 mt-3">
            * {totalTenants - totalPlans} tenant(s) inactivos no incluidos en la
            distribución.
          </p>
        )}
      </div>

      {/* Top tenants */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-bold text-gray-900 mb-4">
          Top 5 lavaderos por ingresos del mes
        </h2>
        {topTenants.length === 0 ? (
          <p className="text-sm text-gray-500">
            Aún no hay datos para este mes.
          </p>
        ) : (
          <div className="space-y-2">
            {topTenants.map((t, idx) => (
              <div
                key={t.id}
                className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0"
              >
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 shrink-0">
                  #{idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm text-gray-900 truncate">
                      {t.name}
                    </p>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${PLAN_COLORS[t.plan] ?? PLAN_COLORS.free}`}
                    >
                      {t.plan.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {t.appointments} citas este mes
                  </p>
                </div>
                <p className="font-bold text-sm text-gray-900 shrink-0">
                  {formatCOP(t.revenue)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-700 font-medium">{label}</span>
        <span className="text-gray-500">
          {count} ({pct}%)
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Tenants Tab ──────────────────────────────────────────────────────────────

interface TenantsFilters {
  search: string;
  plan: string;
  status: string;
}

function TenantsTab() {
  const toast = useToast();
  const [data, setData] = useState<TenantsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<TenantsFilters>({
    search: "",
    plan: "",
    status: "",
  });
  const [page, setPage] = useState(1);
  const [detailFor, setDetailFor] = useState<TenantListItem | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<TenantListItem | null>(
    null,
  );
  const [searchInput, setSearchInput] = useState("");

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("page", String(page));
      qs.set("limit", "20");
      if (filters.search) qs.set("search", filters.search);
      if (filters.plan) qs.set("plan", filters.plan);
      if (filters.status) qs.set("status", filters.status);

      const res = await api<TenantsResponse>(`/superadmin/tenants?${qs}`);
      setData(res);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters, page, toast]);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== filters.search) {
        setFilters((f) => ({ ...f, search: searchInput }));
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, filters.search]);

  const handleToggle = async (tenant: TenantListItem) => {
    try {
      await api(`/superadmin/tenants/${tenant.id}/toggle`, { method: "PATCH" });
      toast.success(
        tenant.isActive
          ? `${tenant.name} desactivado`
          : `${tenant.name} activado`,
      );
      setConfirmToggle(null);
      fetchTenants();
    } catch (err) {
      toast.error((err as Error).message);
      setConfirmToggle(null);
    }
  };

  if (loading && !data) return <SkeletonCard count={6} />;

  const tenants = data?.data ?? [];
  const totalPages = Math.ceil((data?.pagination?.total ?? 0) / 20);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Buscar
            </label>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nombre, slug, email o NIT"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Plan
            </label>
            <select
              title="Selecciona un plan para filtrar los tenants"
              value={filters.plan}
              onChange={(e) => {
                setFilters((f) => ({ ...f, plan: e.target.value }));
                setPage(1);
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 outline-none bg-white"
            >
              <option value="">Todos</option>
              <option value="free">Free</option>
              <option value="basic">Basic</option>
              <option value="pro">Pro</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Estado
            </label>
            <select
              title="Selecciona el estado del tenant"
              value={filters.status}
              onChange={(e) => {
                setFilters((f) => ({ ...f, status: e.target.value }));
                setPage(1);
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 outline-none bg-white"
            >
              <option value="">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </div>
        </div>
      </div>

      {/* Lista */}
      {tenants.length === 0 ? (
        <EmptyState
          icon="🏢"
          title="Sin tenants"
          description={
            filters.search || filters.plan || filters.status
              ? "Ningún resultado con esos filtros."
              : "Cuando alguien se registre desde /signup aparecerá aquí."
          }
        />
      ) : (
        <div className="space-y-2">
          {tenants.map((t) => {
            const inTrial =
              t.trialEndsAt && new Date(t.trialEndsAt) > new Date();
            return (
              <div
                key={t.id}
                className={`bg-white rounded-xl border p-4 ${t.isActive ? "border-gray-100" : "border-red-200 bg-red-50/30"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-gray-900 truncate">
                        {t.name}
                      </p>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${PLAN_COLORS[t.plan] ?? PLAN_COLORS.free}`}
                      >
                        {t.plan?.toUpperCase()}
                      </span>
                      {!t.isActive && <Badge variant="danger">Inactivo</Badge>}
                      {inTrial && <Badge variant="warning">Trial</Badge>}
                      {t.whatsappEnabled && <span className="text-xs">💬</span>}
                      {t.billingProvider && (
                        <span
                          className="text-xs"
                          title={`Facturación: ${t.billingProvider}`}
                        >
                          🧾
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {t.email ?? "—"} · {t.phone ?? "—"} · {t.city ?? "—"}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-400">
                      <span>👤 {t.userCount} usuarios</span>
                      <span>·</span>
                      <span>📅 {t.todayAppointments} hoy</span>
                      <span>·</span>
                      <span className="font-semibold text-gray-700">
                        {formatCOP(t.monthRevenue)} este mes
                      </span>
                      <span>·</span>
                      <span>
                        creado{" "}
                        {new Date(t.createdAt).toLocaleDateString("es-CO")}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    <button
                      onClick={() => setDetailFor(t)}
                      className="text-xs font-medium text-gray-700 hover:text-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition"
                    >
                      Detalle
                    </button>
                    <button
                      onClick={() => setConfirmToggle(t)}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg transition ${
                        t.isActive
                          ? "text-orange-700 hover:bg-orange-50 border border-orange-200"
                          : "text-green-700 hover:bg-green-50 border border-green-200"
                      }`}
                    >
                      {t.isActive ? "Desactivar" : "Activar"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition"
          >
            ← Anterior
          </button>
          <span>
            Página {page} de {totalPages}
          </span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition"
          >
            Siguiente →
          </button>
        </div>
      )}

      {/* Modales */}
      {detailFor && (
        <TenantDetailModal
          tenantId={detailFor.id}
          onClose={() => setDetailFor(null)}
          onChanged={() => {
            fetchTenants();
          }}
        />
      )}
      {confirmToggle && (
        <ConfirmDialog
          title={
            confirmToggle.isActive ? "¿Desactivar tenant?" : "¿Activar tenant?"
          }
          message={
            confirmToggle.isActive
              ? `Al desactivar "${confirmToggle.name}", sus usuarios no podrán acceder al sistema. Los datos se conservan y puedes reactivarlo en cualquier momento.`
              : `Vas a reactivar "${confirmToggle.name}". Sus usuarios podrán acceder de nuevo.`
          }
          confirmLabel={confirmToggle.isActive ? "Desactivar" : "Activar"}
          variant={confirmToggle.isActive ? "danger" : "default"}
          onConfirm={() => handleToggle(confirmToggle)}
          onCancel={() => setConfirmToggle(null)}
        />
      )}
    </div>
  );
}

// ─── Tenant Detail Modal ─────────────────────────────────────────────────────

interface TenantDetailModalProps {
  tenantId: string;
  onClose(): void;
  onChanged(): void;
}

function TenantDetailModal({
  tenantId,
  onClose,
  onChanged,
}: TenantDetailModalProps) {
  const toast = useToast();
  const [data, setData] = useState<TenantDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [changingPlan, setChangingPlan] = useState(false);
  const [newPlan, setNewPlan] = useState<PlanId | "">("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, planList] = await Promise.all([
        api<TenantDetailData>(`/superadmin/tenants/${tenantId}`),
        api<Plan[]>(`/superadmin/plans`),
      ]);
      setData(detail);
      setPlans(planList);
      setNewPlan(detail.tenant.plan);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleChangePlan = async () => {
    if (!data || !newPlan || newPlan === data.tenant.plan) return;
    setChangingPlan(true);
    try {
      const res = await api<ChangePlanResponse>(
        `/superadmin/tenants/${tenantId}/plan`,
        {
          method: "PATCH",
          body: { plan: newPlan },
        },
      );
      toast.success(res.message);
      onChanged();
      fetchAll();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setChangingPlan(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Detalle del tenant</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {loading || !data ? (
          <div className="p-5">
            <SkeletonCard count={3} />
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Header con datos del tenant */}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-lg text-gray-900">
                  {data.tenant.name}
                </h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${PLAN_COLORS[data.tenant.plan] ?? PLAN_COLORS.free}`}
                >
                  {data.tenant.plan?.toUpperCase()}
                </span>
                {!data.tenant.is_active && (
                  <Badge variant="danger">Inactivo</Badge>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1 font-mono">
                {data.tenant.slug}
              </p>
            </div>

            {/* Cambio de plan */}
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-purple-900 uppercase tracking-wide mb-2">
                Cambiar plan
              </p>
              <div className="flex gap-2">
                <select
                  title="Selecciona un plan"
                  value={newPlan}
                  onChange={(e) => setNewPlan(e.target.value as PlanId)}
                  className="flex-1 px-3 py-2 border border-purple-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 outline-none"
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} —{" "}
                      {p.price_monthly === 0
                        ? "Gratis"
                        : `${formatCOP(p.price_monthly)}/mes`}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleChangePlan}
                  disabled={changingPlan || newPlan === data.tenant.plan}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
                >
                  {changingPlan ? "Cambiando..." : "Aplicar"}
                </button>
              </div>
            </div>

            {/* Datos generales */}
            <Section title="Datos del lavadero">
              <DetailGrid
                items={[
                  { label: "Email", value: data.tenant.email ?? "—" },
                  { label: "Teléfono", value: data.tenant.phone ?? "—" },
                  { label: "NIT", value: data.tenant.nit ?? "—" },
                  {
                    label: "Razón social",
                    value: data.tenant.owner_name ?? "—",
                  },
                  { label: "Ciudad", value: data.tenant.city ?? "—" },
                  { label: "Bahías", value: data.tenant.bays_count },
                  {
                    label: "Horario",
                    value: `${data.tenant.opening_time} – ${data.tenant.closing_time}`,
                  },
                  {
                    label: "Trial hasta",
                    value: data.tenant.trial_ends_at
                      ? new Date(data.tenant.trial_ends_at).toLocaleDateString(
                          "es-CO",
                        )
                      : "—",
                  },
                ]}
              />
            </Section>

            {/* Stats */}
            <Section title="Estadísticas">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard
                  label="Clientes"
                  value={data.stats.customers}
                  icon="👥"
                />
                <StatCard
                  label="Vehículos"
                  value={data.stats.vehicles}
                  icon="🚗"
                />
                <StatCard
                  label="Total citas"
                  value={data.stats.total_appointments}
                  icon="📅"
                />
                <StatCard
                  label="Total pagos"
                  value={data.stats.total_payments}
                  icon="💳"
                />
                <StatCard
                  label="Ingreso histórico"
                  value={formatCOP(data.stats.total_revenue)}
                  icon="💰"
                />
              </div>
            </Section>

            {/* Uso vs límites del plan */}
            {data.usage && (
              <Section title="Uso del plan actual">
                <UsageRow
                  label="Turnos del mes"
                  current={data.usage.usage.appointments.current}
                  limit={data.usage.usage.appointments.limit}
                  pct={data.usage.usage.appointments.pct}
                />
                <UsageRow
                  label="Operadores"
                  current={data.usage.usage.operators.current}
                  limit={data.usage.usage.operators.limit}
                  pct={data.usage.usage.operators.pct}
                />
                <UsageRow
                  label="Servicios activos"
                  current={data.usage.usage.services.current}
                  limit={data.usage.usage.services.limit}
                  pct={data.usage.usage.services.pct}
                />
              </Section>
            )}

            {/* WhatsApp + Billing config */}
            <Section title="Integraciones">
              <DetailGrid
                items={[
                  {
                    label: "WhatsApp",
                    value: data.tenant.whatsapp_enabled
                      ? `Activo (${data.tenant.whatsapp_provider ?? "baileys"})`
                      : "Inactivo",
                  },
                  {
                    label: "Tel WhatsApp",
                    value: data.tenant.whatsapp_phone ?? "—",
                  },
                  {
                    label: "Facturación",
                    value: data.tenant.billing_provider
                      ? `${data.tenant.billing_provider} ✅`
                      : "No configurada",
                  },
                  {
                    label: "API Key",
                    value: data.tenant.billing_api_key ?? "—",
                  },
                  {
                    label: "Resolución",
                    value: data.tenant.billing_resolution ?? "—",
                  },
                  {
                    label: "Prefijo",
                    value: data.tenant.billing_prefix ?? "—",
                  },
                ]}
              />
            </Section>

            {/* Usuarios */}
            <Section title={`Usuarios (${data.users.length})`}>
              <div className="space-y-1">
                {data.users.map((u) => (
                  <div
                    key={u.id}
                    className={`flex items-center justify-between py-2 px-3 rounded-lg text-sm ${
                      u.is_active ? "bg-gray-50" : "bg-red-50/40 opacity-60"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {u.first_name} {u.last_name}
                        <span
                          className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                            u.role === "admin"
                              ? "bg-purple-100 text-purple-700"
                              : "bg-gray-200 text-gray-700"
                          }`}
                        >
                          {u.role}
                        </span>
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {u.email}
                      </p>
                    </div>
                    {u.last_login_at && (
                      <p className="text-xs text-gray-400 shrink-0">
                        Último:{" "}
                        {new Date(u.last_login_at).toLocaleDateString("es-CO")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Section>

            {/* Onboarding log */}
            {data.onboarding && data.onboarding.length > 0 && (
              <Section title="Historial de onboarding">
                <ol className="space-y-2 text-xs">
                  {data.onboarding.map((log, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <span className="text-green-500">✓</span>
                      <span className="font-medium text-gray-700">
                        {log.step}
                      </span>
                      <span className="text-gray-400 ml-auto">
                        {formatDateTime(log.created_at)}
                      </span>
                    </li>
                  ))}
                </ol>
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components: Section / DetailGrid / UsageRow ─────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
        {title}
      </p>
      {children}
    </div>
  );
}

interface DetailGridItem {
  label: string;
  value: string | number;
}

function DetailGrid({ items }: { items: DetailGridItem[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {items.map((it, idx) => (
        <div
          key={idx}
          className="flex justify-between gap-3 py-1 border-b border-gray-50 last:border-0"
        >
          <span className="text-gray-500 shrink-0">{it.label}</span>
          <span className="text-gray-900 text-right truncate">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

function UsageRow({
  label,
  current,
  limit,
  pct,
}: {
  label: string;
  current: number;
  limit: number;
  pct: number;
}) {
  const safe = Math.min(pct, 100);
  const color =
    safe >= 90 ? "bg-red-500" : safe >= 70 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="mb-2">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-700">{label}</span>
        <span className="text-gray-500">
          {current} / {limit}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}

// ─── Plans Tab ────────────────────────────────────────────────────────────────

function PlansTab() {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Plan | null>(null);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<Plan[]>("/superadmin/plans");
      setPlans(res);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  if (loading) return <SkeletonCard count={3} />;

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
        Edita los límites y precios de cada plan. Los cambios aplican{" "}
        <strong>inmediatamente</strong> a todos los tenants en ese plan.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} onEdit={() => setEditing(p)} />
        ))}
      </div>

      {editing && (
        <PlanEditModal
          plan={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            fetchPlans();
          }}
        />
      )}
    </div>
  );
}

function PlanCard({ plan, onEdit }: { plan: Plan; onEdit(): void }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-lg text-gray-900">{plan.name}</h3>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {plan.price_monthly === 0
              ? "Gratis"
              : formatCOP(plan.price_monthly)}
            {plan.price_monthly > 0 && (
              <span className="text-xs text-gray-500 font-normal">/mes</span>
            )}
          </p>
        </div>
        <span
          className={`text-xs px-2 py-1 rounded-full ${PLAN_COLORS[plan.id] ?? PLAN_COLORS.free}`}
        >
          {plan.tenantCount} {plan.tenantCount === 1 ? "tenant" : "tenants"}
        </span>
      </div>

      <ul className="space-y-1.5 text-sm text-gray-700 flex-1 mb-4">
        <li className="flex items-center gap-2">
          <span className="text-gray-400">📅</span>
          <span>
            {plan.max_appointments_month?.toLocaleString("es-CO") ?? "—"}{" "}
            citas/mes
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="text-gray-400">👥</span>
          <span>
            {plan.max_operators}{" "}
            {plan.max_operators === 1 ? "operador" : "operadores"}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="text-gray-400">🧽</span>
          <span>{plan.max_services} servicios activos</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="text-gray-400">🚿</span>
          <span>
            {plan.max_bays} {plan.max_bays === 1 ? "bahía" : "bahías"}
          </span>
        </li>
        <li
          className={`flex items-center gap-2 ${plan.whatsapp_enabled ? "" : "opacity-40"}`}
        >
          <span>{plan.whatsapp_enabled ? "✅" : "❌"}</span>
          <span>WhatsApp Bot</span>
        </li>
        <li
          className={`flex items-center gap-2 ${plan.billing_enabled ? "" : "opacity-40"}`}
        >
          <span>{plan.billing_enabled ? "✅" : "❌"}</span>
          <span>Facturación electrónica</span>
        </li>
        <li
          className={`flex items-center gap-2 ${plan.reports_enabled ? "" : "opacity-40"}`}
        >
          <span>{plan.reports_enabled ? "✅" : "❌"}</span>
          <span>Reportes avanzados</span>
        </li>
      </ul>

      <button
        onClick={onEdit}
        className="w-full py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-lg transition"
      >
        Editar plan
      </button>
    </div>
  );
}

// ─── PlanEditModal ────────────────────────────────────────────────────────────

interface PlanEditForm {
  name: string;
  priceMonthly: number | string;
  maxOperators: number | string;
  maxAppointmentsMonth: number | string;
  maxServices: number | string;
  maxBays: number | string;
  whatsappEnabled: boolean;
  billingEnabled: boolean;
  reportsEnabled: boolean;
}

function PlanEditModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: Plan;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<PlanEditForm>({
    name: plan.name,
    priceMonthly: plan.price_monthly,
    maxOperators: plan.max_operators,
    maxAppointmentsMonth: plan.max_appointments_month,
    maxServices: plan.max_services,
    maxBays: plan.max_bays,
    whatsappEnabled: plan.whatsapp_enabled,
    billingEnabled: plan.billing_enabled,
    reportsEnabled: plan.reports_enabled,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api(`/superadmin/plans/${plan.id}`, {
        method: "PUT",
        body: {
          name: form.name,
          priceMonthly: parseInt(String(form.priceMonthly), 10) || 0,
          maxOperators: parseInt(String(form.maxOperators), 10) || 1,
          maxAppointmentsMonth:
            parseInt(String(form.maxAppointmentsMonth), 10) || 100,
          maxServices: parseInt(String(form.maxServices), 10) || 5,
          maxBays: parseInt(String(form.maxBays), 10) || 1,
          whatsappEnabled: form.whatsappEnabled,
          billingEnabled: form.billingEnabled,
          reportsEnabled: form.reportsEnabled,
        },
      });
      toast.success("Plan actualizado");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof PlanEditForm>(key: K, val: PlanEditForm[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">
            Editar plan: {plan.id.toUpperCase()}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Nombre comercial
          </label>
          <input
            title={form.name}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Precio mensual (COP en centavos)
          </label>
          <input
            title={String(form.priceMonthly)}
            type="number"
            value={form.priceMonthly}
            onChange={(e) => set("priceMonthly", e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 outline-none"
          />
          <p className="text-xs text-gray-400 mt-1">
            {formatCOP(parseInt(String(form.priceMonthly), 10) || 0)} mostrado
            al usuario
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumField
            label="Citas/mes"
            value={form.maxAppointmentsMonth}
            onChange={(v) => set("maxAppointmentsMonth", v)}
          />
          <NumField
            label="Operadores"
            value={form.maxOperators}
            onChange={(v) => set("maxOperators", v)}
          />
          <NumField
            label="Servicios"
            value={form.maxServices}
            onChange={(v) => set("maxServices", v)}
          />
          <NumField
            label="Bahías"
            value={form.maxBays}
            onChange={(v) => set("maxBays", v)}
          />
        </div>

        <div className="space-y-2 pt-2 border-t border-gray-100">
          <Toggle
            label="WhatsApp Bot incluido"
            value={form.whatsappEnabled}
            onChange={(v) => set("whatsappEnabled", v)}
          />
          <Toggle
            label="Facturación electrónica"
            value={form.billingEnabled}
            onChange={(v) => set("billingEnabled", v)}
          />
          <Toggle
            label="Reportes avanzados"
            value={form.reportsEnabled}
            onChange={(v) => set("reportsEnabled", v)}
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar plan"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── NumField / Toggle ───────────────────────────────────────────────────────

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | string;
  onChange(v: string): void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
      </label>
      <input
        title={String(value)}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 outline-none"
      />
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange(v: boolean): void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="w-full flex items-center justify-between gap-3 py-2 group"
    >
      <span className="text-sm text-gray-700">{label}</span>
      <span
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition shrink-0 ${
          value ? "bg-green-500" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
            value ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}
