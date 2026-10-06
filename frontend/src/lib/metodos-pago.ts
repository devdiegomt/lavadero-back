/**
 * Los métodos de pago, con su ícono. Estaban repetidos en el modal de cobro y
 * en la página de pagos, cada uno con sus emojis.
 */
import { Banknote, CreditCard, Landmark, Smartphone, type LucideIcon } from 'lucide-react';
import type { PaymentMethod } from '../types';

export interface MetodoPago {
  value: PaymentMethod;
  label: string;
  icon: LucideIcon;
}

export const METODOS_PAGO: MetodoPago[] = [
  { value: 'cash',      label: 'Efectivo',      icon: Banknote },
  { value: 'nequi',     label: 'Nequi',         icon: Smartphone },
  { value: 'daviplata', label: 'Daviplata',     icon: Smartphone },
  { value: 'transfer',  label: 'Transferencia', icon: Landmark },
  { value: 'card',      label: 'Tarjeta',       icon: CreditCard },
];
