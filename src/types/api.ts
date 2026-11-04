/**
 * Tipos de API: shapes de request bodies y response DTOs.
 *
 * Convención:
 *   - `*Dto`      → lo que el controller envía al cliente (camelCase)
 *   - `*Body`     → lo que el controller recibe del cliente (validado por Zod)
 *   - `Paginated<T>` → wrapper de respuestas paginadas
 */

import type {
  PlanId,
  SubscriptionStatus,
  UserRole,
  InvoiceStatus,
  PaymentMethod,
  BillingProvider,
  WhatsAppProvider,
  AppointmentStatus,
  VehicleType,
} from './entities';

// ─── Generics ─────────────────────────────────────────────────────────────────

export interface Pagination {
  total: number;
  page: number;
  limit: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;              // user.id
  tenantId: string | null;  // null para super_admin
  role: UserRole;
  email: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  plan: PlanId;
}

export interface AuthUserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  role: UserRole;
  tenant: TenantSummary | null;
}

export interface LoginResponseDto {
  accessToken: string;
  /**
   * **Obsoleto.** El refresh token va en una cookie `httpOnly`; sólo aparece acá
   * si `AUTH_REFRESH_IN_BODY` está en `true`, que existe para no dejar sin sesión
   * a un frontend viejo durante el despliegue. Un cliente nuevo no debe usarlo:
   * guardarlo del lado del JavaScript es la brecha que esto vino a cerrar.
   */
  refreshToken?: string;
  user: AuthUserDto;
}

// ─── Planes y uso ─────────────────────────────────────────────────────────────

export interface UsageMetric {
  current: number;
  /** null = sin límite en este plan. */
  limit: number | null;
  /** 0–100; null si no hay límite. */
  pct: number | null;
}

export interface TenantUsageDto {
  plan: {
    id: PlanId;
    name: string;
    priceMonthly: number;
    /** Lo que paga este lavadero: el precio con su descuento, si tiene uno vigente. */
    priceWithDiscount: number;
  };
  subscription: {
    status: SubscriptionStatus;
    trialEndsAt: string | null;
    /** Días que quedan de prueba; null si no está en prueba. */
    trialDaysLeft: number | null;
    /** Si el panel está en sólo lectura: prueba vencida o suspendido. */
    readOnly: boolean;
    discountPct: number;
    discountUntil: string | null;
  };
  /** Los planes que se ofrecen hoy, para comparar. */
  availablePlans: Array<{
    id: PlanId;
    name: string;
    priceMonthly: number;
    maxOperators: number | null;
    whatsapp: boolean;
    billing: boolean;
    reports: boolean;
  }>;
  usage: {
    appointments: UsageMetric;
    operators: UsageMetric;
    services: UsageMetric;
  };
  features: {
    whatsapp: boolean;
    billing: boolean;
    reports: boolean;
  };
}

// ─── Billing ──────────────────────────────────────────────────────────────────

export interface AlegraNumberTemplate {
  id: number | string;
  name: string;
  prefix: string | null;
  currentNumber: number;
  status: string;
}

export interface BillingConfigDto {
  isConfigured: boolean;
  connectionOk: boolean;
  provider: BillingProvider | null;
  resolution: string | null;
  prefix: string | null;
  nit: string | null;
  companyName?: string;
  numberTemplates?: AlegraNumberTemplate[];
}

export interface BillingTestResultDto {
  message: string;
  company?: { name: string; identification: string };
  numberTemplates: number;
  taxes: number;
}

export interface InvoiceStatusDto {
  hasInvoice: boolean;
  invoice?: {
    number: string | null;
    status: InvoiceStatus;
    customer: string;
    customerEmail: string | null;
    plate: string;
    serviceName: string;
    amount: number;
    paymentMethod: PaymentMethod;
    createdAt: string;
    cufe: string | null;
    pdfUrl: string | null;
  };
  dianDetails?: {
    date?: string;
    legalStatus?: string;
  };
}

// ─── Superadmin ───────────────────────────────────────────────────────────────

export interface SaasOverviewDto {
  activeTenants: number;
  inactiveTenants: number;
  inTrial: number;
  totalUsers: number;
  todayAppointments: number;
  monthAppointments: number;
  monthRevenue: number;    // en centavos
  newTenantsWeek: number;
  newTenantsMonth: number;
}

export interface TopTenantDto {
  id: string;
  name: string;
  slug: string;
  plan: PlanId;
  appointments: number;
  revenue: number;         // en centavos
}

export interface SuperAdminDashboardDto {
  overview: SaasOverviewDto;
  planDistribution: Partial<Record<PlanId, number>>;
  topTenants: TopTenantDto[];
}

export interface TenantListItemDto {
  id: string;
  name: string;
  slug: string;
  nit: string | null;
  ownerName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  plan: PlanId;
  isActive: boolean;
  trialEndsAt: string | null;
  whatsappEnabled: boolean;
  billingProvider: BillingProvider | null;
  userCount: number;
  todayAppointments: number;
  monthRevenue: number;    // en centavos
  createdAt: string;
}

// ─── WhatsApp bridge ──────────────────────────────────────────────────────────

export interface WaBridgeIncomingMessage {
  phone: string;
  message: string;
  tenantPhone: string;
  timestamp: string;
  messageId: string;
  pushName?: string;
}

// ─── Kanban / Board ───────────────────────────────────────────────────────────

/** Turno tal como lo muestra el tablero Kanban */
export interface KanbanCard {
  id: string;
  status: AppointmentStatus;
  plate: string;
  vehicleType: VehicleType;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  estimatedMinutes: number;
  bayNumber: number | null;
  operatorName: string | null;
  scheduledTime: string | null;
  startedAt: string | null;
  totalAmount: number;
  source: string;
  notes: string | null;
}

// ─── Errores ──────────────────────────────────────────────────────────────────

export interface ApiErrorResponse {
  error: string;
  details?: unknown;
}