/**
 * Mi cuenta — cambiar la contraseña propia.
 *
 * Hasta acá el panel **no tenía forma de que nadie cambiara su propia
 * contraseña**. Lo único parecido era el editor de usuarios de Configuración,
 * que es de admins y sirve para cambiarle la contraseña a *otro*. Un admin que
 * se editaba a sí mismo recibía:
 *
 *     400 · La contraseña actual es requerida
 *
 * ...y el formulario no tenía ese campo. Un error sin salida. Comprobado contra
 * el backend antes de escribir esto.
 *
 * Usa `PATCH /api/auth/password`, que existe porque la ruta de `users` va bajo
 * `requireTenant` y el superadministrador no tiene tenant — era la cuenta con
 * más poder del sistema y la única sin forma de rotar su credencial.
 *
 * **Cambiar la contraseña cierra todas las sesiones**, incluida ésta. Es a
 * propósito: si alguien la cambia es porque puede estar comprometida, y las
 * sesiones abiertas con la anterior valen siete días más. Por eso acá se cierra
 * sesión de forma explícita en vez de dejar que muera sola en la próxima
 * renovación, que es lo mismo pero desconcertante.
 */
import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError } from '../lib/api';
import { useToast } from '../components/ui';

const MINIMO = 8;

export default function AccountPage() {
  const { user, logout } = useAuth();
  const toast = useToast();

  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [listo, setListo] = useState(false);

  const problema = (): string | null => {
    if (!actual) return 'Escribe tu contraseña actual.';
    if (nueva.length < MINIMO) return `La contraseña nueva debe tener al menos ${MINIMO} caracteres.`;
    if (nueva !== repetida) return 'Las dos contraseñas nuevas no coinciden.';
    if (nueva === actual) return 'La contraseña nueva tiene que ser distinta de la actual.';
    return null;
  };

  async function enviar(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    const mal = problema();
    if (mal) {
      toast.error(mal);
      return;
    }

    setGuardando(true);
    try {
      await api('/auth/password', {
        method: 'PATCH',
        body: { currentPassword: actual, newPassword: nueva },
      });

      // El servidor ya revocó todo. Mostrarlo y salir, en vez de dejar una
      // sesión que va a caerse sola dentro de un rato sin explicación.
      setListo(true);
      setActual('');
      setNueva('');
      setRepetida('');
      setTimeout(() => void logout(), 2500);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      toast.error(msg || 'No se pudo cambiar la contraseña');
    } finally {
      setGuardando(false);
    }
  }

  if (listo) {
    return (
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center space-y-2">
          <span className="text-3xl">🔐</span>
          <h1 className="text-lg font-bold text-gray-900">Contraseña actualizada</h1>
          <p className="text-sm text-gray-500">
            Se cerraron todas las sesiones, incluida ésta. Vas a volver al inicio de sesión.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Mi cuenta</h1>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-1">
        <p className="text-sm font-medium text-gray-900">
          {user?.firstName} {user?.lastName}
        </p>
        <p className="text-xs text-gray-500">{user?.email}</p>
        <p className="text-xs text-gray-400">{user?.role}</p>
      </div>

      <form onSubmit={enviar} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Cambiar contraseña</h2>
          <p className="text-xs text-gray-500 mt-1">
            Al cambiarla se cierran todas las sesiones abiertas, también en otros dispositivos.
          </p>
        </div>

        <Campo
          id="actual"
          label="Contraseña actual"
          value={actual}
          onChange={setActual}
          autoComplete="current-password"
        />
        <Campo
          id="nueva"
          label={`Contraseña nueva (mínimo ${MINIMO} caracteres)`}
          value={nueva}
          onChange={setNueva}
          autoComplete="new-password"
        />
        <Campo
          id="repetida"
          label="Repite la contraseña nueva"
          value={repetida}
          onChange={setRepetida}
          autoComplete="new-password"
        />

        <button
          type="submit"
          disabled={guardando}
          className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition disabled:opacity-50 text-sm"
        >
          {guardando ? 'Cambiando...' : 'Cambiar contraseña'}
        </button>
      </form>
    </div>
  );
}

interface CampoProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}

function Campo({ id, label, value, onChange, autoComplete }: CampoProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1">
        {label}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
      />
    </div>
  );
}
