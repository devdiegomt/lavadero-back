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
  refreshToken: string;
  user: AuthUserDto;
}

// ─── Planes y uso ─────────────────────────────────────────────────────────────

export interface UsageMetric {
  current: number;
  limit: number;
  pct: number; // 0–100
}

export interface TenantUsageDto {
  plan: {
    id: PlanId;
    name: string;
    priceMonthly: number;
  };
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
  planDistribution: Record<PlanId, number>;
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