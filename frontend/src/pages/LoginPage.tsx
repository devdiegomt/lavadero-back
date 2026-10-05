import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate, Link } from 'react-router-dom';
import { ApiError } from '../lib/api';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Marca: la palabra sola, ancha y espaciada, con una línea de latón. */}
        <div className="mb-10">
          <p
            className="text-[1.6rem] font-semibold uppercase text-gray-900 leading-none"
            style={{ fontStretch: '125%', letterSpacing: '0.18em' }}
          >
            Carwash
          </p>
          <div aria-hidden="true" className="w-10 h-px bg-brand-600 my-4" />
          <h1 className="text-sm font-normal text-gray-500" style={{ fontStretch: '100%' }}>Panel del lavadero</h1>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-gray-100 rounded-xl shadow-2xl shadow-black/40 p-6 space-y-5"
        >
          {error && (
            <div role="alert" className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block etiqueta text-gray-500 mb-2">
              Correo
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-600 focus:border-transparent outline-none transition text-sm text-gray-900 placeholder:text-gray-400"
              placeholder="tu@correo.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block etiqueta text-gray-500 mb-2">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-600 focus:border-transparent outline-none transition text-sm text-gray-900 placeholder:text-gray-400"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>

          {/* Signup link - feature de Phase 3 (onboarding self-service) */}
          <div className="text-center text-sm text-gray-500 pt-3 border-t border-gray-100">
            ¿No tienes cuenta?{' '}
            <Link to="/signup" className="text-brand-700 hover:text-brand-800 font-semibold">
              Crea tu lavadero
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}