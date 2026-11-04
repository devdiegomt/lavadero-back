/**
 * El aviso de arriba del panel: la prueba que se termina, o el sólo lectura.
 *
 * Lo ven todos, también los operarios: si el panel no deja registrar un
 * turno, el que está con el carro enfrente tiene que saber por qué. El enlace
 * a elegir plan, en cambio, sólo le sirve al administrador.
 */
import { Link } from 'react-router-dom';
import { Clock, Lock } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useSuscripcion } from '../lib/suscripcion';

/** Desde cuántos días antes de que venza la prueba se avisa. */
const AVISAR_DESDE_DIAS = 3;

export default function AvisoSuscripcion() {
  const { user } = useAuth();
  const s = useSuscripcion();
  if (!s) return null;

  const { readOnly, status, trialDaysLeft } = s.subscription;
  const esAdmin = user?.role === 'admin';
  const porVencer = status === 'trial' && !readOnly && trialDaysLeft !== null && trialDaysLeft <= AVISAR_DESDE_DIAS;
  if (!readOnly && !porVencer) return null;

  const Icono = readOnly ? Lock : Clock;
  const texto = readOnly
    ? status === 'suspended'
      ? 'La cuenta está suspendida: puedes ver todo, pero no registrar cambios.'
      : 'La prueba terminó: puedes ver todos tus datos, pero no registrar turnos ni pagos hasta elegir un plan.'
    : trialDaysLeft === 1
      ? 'Tu prueba de Qlarity termina mañana.'
      : `A tu prueba de Qlarity le quedan ${trialDaysLeft} días.`;

  return (
    <div
      role={readOnly ? 'alert' : 'status'}
      className={`mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-sm ${
        readOnly ? 'border-red-200 bg-red-50 text-red-900' : 'border-brand-300 bg-brand-50 text-brand-900'
      }`}
    >
      <Icono aria-hidden="true" size={17} strokeWidth={1.8} className="shrink-0" />
      <span className="flex-1 min-w-[12rem]">{texto}</span>
      {esAdmin ? (
        <Link to="/settings?tab=plan" className="font-semibold underline underline-offset-2 whitespace-nowrap">
          Ver planes
        </Link>
      ) : (
        <span className="text-xs opacity-80">Avísale al administrador del lavadero.</span>
      )}
    </div>
  );
}
