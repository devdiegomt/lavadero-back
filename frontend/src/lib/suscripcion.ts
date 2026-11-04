/**
 * El plan y la suscripción del lavadero, como los devuelve `/tenants/me/usage`.
 *
 * Lo usan la sección «Plan» de Configuración y el aviso de arriba del panel.
 * Se pide una vez por carga y se comparte: el aviso está en todas las pantallas
 * y no tiene sentido pedirlo en cada una.
 */
import { useEffect, useState } from 'react';
import { api } from './api';

export interface Metrica {
  current: number;
  /** null = sin límite en este plan. */
  limit: number | null;
  pct: number | null;
}

export interface PlanOfrecido {
  id: string;
  name: string;
  priceMonthly: number;
  maxOperators: number | null;
  whatsapp: boolean;
  billing: boolean;
  reports: boolean;
}

export interface Suscripcion {
  plan: { id: string; name: string; priceMonthly: number; priceWithDiscount: number };
  subscription: {
    status: 'trial' | 'active' | 'suspended';
    trialEndsAt: string | null;
    trialDaysLeft: number | null;
    readOnly: boolean;
    discountPct: number;
    discountUntil: string | null;
  };
  availablePlans: PlanOfrecido[];
  usage: { operators: Metrica; appointments: Metrica; services: Metrica };
  features: { whatsapp: boolean; billing: boolean; reports: boolean };
}

let pedido: Promise<Suscripcion> | null = null;

/** Para después de un cambio de plan: que la próxima lectura vaya a la API. */
export function olvidarSuscripcion(): void {
  pedido = null;
}

export function useSuscripcion(): Suscripcion | null {
  const [datos, setDatos] = useState<Suscripcion | null>(null);
  useEffect(() => {
    let vivo = true;
    pedido ??= api<Suscripcion>('/tenants/me/usage');
    pedido
      .then((d) => vivo && setDatos(d))
      .catch(() => {
        // Sin datos de plan el panel funciona igual; sólo no muestra el aviso.
        pedido = null;
      });
    return () => {
      vivo = false;
    };
  }, []);
  return datos;
}

/** A quién escribirle para elegir plan. Configurable en Vercel. */
export const CONTACTO_VENTAS: string | undefined = import.meta.env.VITE_CONTACTO_VENTAS || undefined;
