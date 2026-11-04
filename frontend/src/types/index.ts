/**
 * Tipos del frontend.
 *
 * Reflejan los shapes que devuelve el backend (camelCase).
 * No duplicar lógica del backend — solo describir el contrato del API.
 *
 * Convención de uso en componentes:
 *   import type { AuthUser, Appointment } from '@/types';
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type UserRole          = 'admin' | 'operator' | 'super_admin';
export type PlanId            = 'free' | 'basic' | 'pro';
export type AppointmentStatus = 'pending' | 'in_progress' | 'done' | 'delivered' | 'cancelled';
export type AppointmentSource = 'walk_in' | 'whatsapp' | 'phone' | 'web';
export type VehicleType       = 'sedan' | 'suv' | 'camioneta' | 'moto' | 'pickup';
export type PaymentMethod     = 'cash' | 'transfer' | 'nequi' | 'daviplata' | 'card' | 'other';
export type InvoiceStatus     = 'pending' | 'accepted' | 'rejected' | 'failed' | 'voided';
export type DocumentType      = 'CC' | 'NIT' | 'CE' | 'PP' | 'TI';
export type BillingProvider   = 'alegra' | 'siigo';
export type WhatsAppProvider  = 'baileys' | 'twilio' | '360dialog';

// ─── Auth & Sesión ────────────────────────────────────────────────────────────

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  plan: PlanId;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  role: UserRole;
  tenant: TenantSummary | null;
}

// ─── Paginación ───────────────────────────────────────────────────────────────

export interface Pagination {
  total: number;
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

// ─── Entidades ────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  nit: string | null;
  ownerName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  openingTime: string;
  closingTime: string;
  baysCount: number;
  plan: PlanId;
  isActive: boolean;
  trialEndsAt: string | null;
  whatsappEnabled: boolean;
  whatsappPhone: string | null;
  whatsappProvider: WhatsAppProvider | null;
  billingProvider: BillingProvider | null;
  billingResolution: string | null;
  billingPrefix: string | null;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  email: string | null;
  documentType: DocumentType;
  documentNumber: string | null;
  notes: string | null;
  createdAt: string;
  vehicleCount?: number;
  lastVisit?: string;
}

export interface Vehicle {
  id: string;
  customerId: string;
  plate: string;
  vehicleType: VehicleType;
  brand: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  priceSedan: number;       // en centavos
  priceSuv: number;
  priceCamioneta: number;
  priceMoto: number;
  pricePickup: number;
  estimatedMinutes: number;
  isActive: boolean;
  sortOrder: number;
}

export interface Appointment {
  id: string;
  status: AppointmentStatus;
  scheduledDate: string;    // 'YYYY-MM-DD'
  scheduledTime: string | null;
  bayNumber: number | null;
  notes: string | null;
  source: AppointmentSource;
  totalAmount: number;      // en centavos
  startedAt: string | null;
  finishedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  // Joins frecuentes
  customerFirstName?: string;
  customerLastName?: string | null;
  customerPhone?: string;
  plate?: string;
  vehicleType?: VehicleType;
  serviceName?: string;
  estimatedMinutes?: number;
  operatorFirstName?: string | null;
  operatorLastName?: string | null;
}

export interface Payment {
  id: string;
  appointmentId: string;
  amount: number;           // en centavos
  paymentMethod: PaymentMethod;
  invoiceStatus: InvoiceStatus | null;
  invoiceNumber: string | null;
  invoiceCufe: string | null;
  invoicePdfUrl: string | null;
  createdAt: string;
  // Joins
  firstName?: string;
  lastName?: string | null;
  phone?: string;
  plate?: string;
  serviceName?: string;
}

// ─── Plan & uso ───────────────────────────────────────────────────────────────

export interface UsageMetric {
  current: number;
  limit: number;
  pct: number;
}

export interface TenantUsage {
  plan: { id: PlanId; name: string; priceMonthly: number };
  usage: {
    appointments: UsageMetric;
    operators: UsageMetric;
    services: UsageMetric;
  };
  features: { whatsapp: boolean; billing: boolean; reports: boolean };
}

export interface Plan {
  id: PlanId;
  name: string;
  priceMonthly: number;
  maxOperators: number;
  maxAppointmentsMonth: number;
  maxServices: number;
  maxBays: number;
  whatsappEnabled: boolean;
  billingEnabled: boolean;
  reportsEnabled: boolean;
  isActive: boolean;
  tenantCount?: number;
}

// ─── Billing ─────────────────────────────────────────────────────────────────

export interface BillingConfig {
  isConfigured: boolean;
  connectionOk: boolean;
  provider: BillingProvider | null;
  resolution: string | null;
  prefix: string | null;
  nit: string | null;
  companyName?: string;
  numberTemplates?: Array<{
    id: string | number;
    name: string;
    prefix: string | null;
    currentNumber: number;
    status: string;
  }>;
}

// ─── API client ───────────────────────────────────────────────────────────────

/** Opciones para la función `api()` de src/lib/api.ts */
export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}