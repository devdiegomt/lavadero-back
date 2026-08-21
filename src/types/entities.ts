/**
 * Tipos de dominio del SaaS.
 *
 * Convención:
 *   - `*Row`   → forma exacta que devuelve PostgreSQL (snake_case)
 *   - Sin sufijo → shape que devuelven los controllers al cliente (camelCase)
 *
 * Los controllers mapean de Row → DTO antes de hacer res.json().
 * La DB siempre habla Row; el cliente siempre habla DTO.
 */

// ─── Enums compartidos ────────────────────────────────────────────────────────

export type UserRole        = 'admin' | 'operator' | 'super_admin';
export type PlanId          = 'free' | 'basic' | 'pro';
export type AppointmentStatus = 'pending' | 'in_progress' | 'done' | 'delivered' | 'cancelled';
export type AppointmentSource = 'walk_in' | 'whatsapp' | 'phone' | 'web';
export type VehicleType     = 'sedan' | 'suv' | 'camioneta' | 'moto' | 'pickup';
export type PaymentMethod   = 'cash' | 'transfer' | 'nequi' | 'daviplata' | 'card' | 'other';
export type InvoiceStatus   = 'pending' | 'accepted' | 'rejected' | 'failed' | 'voided';
export type DocumentType    = 'CC' | 'NIT' | 'CE' | 'PP' | 'TI';
export type WhatsAppProvider = 'baileys' | 'twilio' | '360dialog';
export type BillingProvider = 'alegra' | 'siigo';
export type Currency        = 'COP' | 'USD';

// ─── FSM de turnos ────────────────────────────────────────────────────────────

export const VALID_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  pending:     ['in_progress', 'cancelled'],
  in_progress: ['done',        'cancelled'],
  done:        ['delivered',   'cancelled'],
  delivered:   [],
  cancelled:   [],
} as const;

// ─── Database rows (PostgreSQL → snake_case) ──────────────────────────────────

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  nit: string | null;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  timezone: string;
  opening_time: string;     // 'HH:MM'
  closing_time: string;     // 'HH:MM'
  bays_count: number;
  currency: Currency;
  plan: PlanId;
  is_active: boolean;
  trial_ends_at: Date | null;
  whatsapp_enabled: boolean;
  whatsapp_phone: string | null;
  whatsapp_provider: WhatsAppProvider | null;
  billing_provider: BillingProvider | null;
  billing_api_key: string | null;   // cifrado AES-256-GCM en BD
  billing_resolution: string | null;
  billing_prefix: string | null;
  created_at: Date;
}

export interface UserRow {
  id: string;
  tenant_id: string | null;    // null solo para super_admin
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

export interface CustomerRow {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name: string | null;
  phone: string;
  email: string | null;
  document_type: DocumentType;
  document_number: string | null;
  notes: string | null;
  deleted_at: Date | null;
  created_at: Date;
}

export interface VehicleRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  plate: string;
  vehicle_type: VehicleType;
  brand: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  deleted_at: Date | null;
  created_at: Date;
}

export interface ServiceRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  price_sedan: number;        // en centavos
  price_suv: number;
  price_camioneta: number;
  price_moto: number;
  price_pickup: number;
  estimated_minutes: number;
  is_active: boolean;
  sort_order: number;
  alegra_item_id: string | null;
  created_at: Date;
}

export interface AppointmentRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  vehicle_id: string;
  service_id: string;
  assigned_to: string | null;
  status: AppointmentStatus;
  scheduled_date: string;     // 'YYYY-MM-DD' — string, no Date, porque viene de DATE
  scheduled_time: string | null; // 'HH:MM'
  bay_number: number | null;
  notes: string | null;
  source: AppointmentSource;
  started_at: Date | null;
  completed_at: Date | null;   // cuando status → 'done'
  delivered_at: Date | null;
  cancelled_at: Date | null;
  total_amount: number;       // en centavos
  created_at: Date;
  updated_at: Date;
}

export interface PaymentRow {
  id: string;
  tenant_id: string;
  appointment_id: string;
  amount: number;             // en centavos
  payment_method: PaymentMethod;
  received_by: string | null;
  invoice_id: string | null;
  invoice_status: InvoiceStatus | null;
  invoice_number: string | null;
  invoice_cufe: string | null;
  invoice_pdf_url: string | null;
  created_at: Date;
}

export interface PlanRow {
  id: PlanId;
  name: string;
  description: string | null;
  price_monthly: number;      // en centavos
  max_operators: number;
  max_appointments_month: number;
  max_services: number;
  max_bays: number;
  whatsapp_enabled: boolean;
  billing_enabled: boolean;
  reports_enabled: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface AppointmentHistoryRow {
  id: string;
  appointment_id: string;
  tenant_id: string;
  previous_status: AppointmentStatus | null;
  new_status: AppointmentStatus;
  changed_by: string | null;
  notes: string | null;
  created_at: Date;
}

export interface OnboardingLogRow {
  id: string;
  tenant_id: string;
  step: string;
  created_at: Date;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
}

// ─── Joins frecuentes (tipos de conveniencia) ─────────────────────────────────
// Se usan cuando el controller hace un JOIN y necesita tipar el resultado.

/** AppointmentRow enriquecido con datos del customer, vehicle, service y operador */
export interface AppointmentJoined extends AppointmentRow {
  customer_first_name: string;
  customer_last_name: string | null;
  customer_phone: string;
  plate: string;
  vehicle_type: VehicleType;
  brand: string | null;
  model: string | null;
  color: string | null;
  service_name: string;
  estimated_minutes: number;
  operator_first_name: string | null;
  operator_last_name: string | null;
}

/** PaymentRow enriquecido con datos del cliente y vehículo */
export interface PaymentJoined extends PaymentRow {
  first_name: string;
  last_name: string | null;
  phone: string;
  document_number: string | null;
  email: string | null;
  plate: string;
  vehicle_type: VehicleType;
  service_name: string;
  received_by_name: string | null;
}