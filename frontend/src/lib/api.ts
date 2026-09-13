/// <reference types="vite/client" />

import type { ApiOptions } from '../types';

/**
 * Cliente HTTP del panel.
 *
 * ## Dónde vive la sesión, y por qué cambió
 *
 * Antes los dos tokens se guardaban en `localStorage`. Eso es legible por
 * cualquier JavaScript de la página —una dependencia comprometida, un texto sin
 * escapar— así que un XSS se llevaba el **refresh token**, y con él siete días de
 * sesión renovable que sobreviven al cierre del navegador.
 *
 * Ahora:
 *
 * - **Refresh token**: en una cookie `httpOnly` que pone el backend. Este código
 *   no lo ve ni lo puede ver; el navegador la manda sólo a `/api/auth`.
 * - **Access token**: en una variable de este módulo, sin persistir. Un XSS lo
 *   puede leer, pero dura 15 minutos y no se puede renovar sin la cookie. Se pasa
 *   de "sesión comprometida indefinidamente" a "quince minutos".
 *
 * El precio de no persistir el access token es que al recargar la página hay que
 * pedir uno nuevo. Eso lo hace `restaurarSesion()`, que se llama al arrancar.
 */

const API_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * Cabecera que el backend exige en los endpoints que se autentican con cookie.
 *
 * Es la defensa contra CSRF de `refresh` y `logout`: un `<form>` de un sitio
 * ajeno no puede ponerla, y un `fetch` cross-origin que la pone dispara un
 * preflight que CORS rechaza. Las demás rutas no la necesitan porque se
 * autentican con `Authorization`, que el navegador nunca adjunta solo.
 */
const CABECERA_PANEL = 'x-panel-request';

/**
 * Rutas donde un 401 es "credenciales inválidas", no "el token venció".
 *
 * Para el resto, un 401 se responde pidiendo un token nuevo con la cookie. Acá
 * no hay nada que renovar.
 */
const ESTABLECEN_SESION = new Set(['/auth/login', '/auth/refresh']);

/** En memoria a propósito. Ver la cabecera del archivo. */
let accessToken: string | null = null;

let onAuthError: (() => void) | null = null;

export function setAuthErrorHandler(handler: () => void): void {
  onAuthError = handler;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearTokens(): void {
  accessToken = null;
  localStorage.removeItem('user');
  // La cookie la borra el backend en /auth/logout: desde acá no se puede,
  // justamente porque es httpOnly.
}

/**
 * Los datos del usuario para mostrar, no una credencial.
 *
 * Se guardan para que al recargar no parpadee la interfaz mientras se restaura
 * la sesión. No sirven para autenticarse: sin access token, el backend responde
 * 401 igual.
 */
export function getStoredUser<T = unknown>(): T | null {
  try {
    const raw = localStorage.getItem('user');
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: unknown): void {
  localStorage.setItem('user', JSON.stringify(user));
}

/**
 * La renovación en curso, si hay una.
 *
 * El backend **rota** el refresh token: cada `/auth/refresh` emite uno nuevo y
 * revoca el anterior en el acto. Eso es lo correcto —un token robado deja de
 * servir en cuanto el dueño renueva— pero vuelve fatal renovar dos veces a la
 * vez: la segunda llega con un token ya revocado, recibe 401 y este cliente
 * cierra la sesión.
 *
 * Y renovar dos veces a la vez es lo normal, no lo raro. Al cargar una pantalla
 * el panel dispara varias consultas en paralelo; si el access token no está
 * —justo después de recargar, que es el caso de siempre ahora que no se
 * persiste— todas responden 401 y todas querrían renovar.
 *
 * Esto lo encontró una prueba en navegador: tres pantallas de nueve cerraban
 * sesión sola al entrar, y el log del backend tenía exactamente tres
 * `Refresh token inválido o expirado`. Con `supertest` no aparece: las
 * peticiones van de a una.
 *
 * Queda un caso que esto no cubre: **dos pestañas** comparten la cookie pero no
 * esta variable, así que si renuevan en el mismo instante una pierde. Hace
 * falta un candado entre pestañas (`BroadcastChannel` o `navigator.locks`) o
 * una ventana de gracia en el backend. Anotado en docs/05-seguridad.md.
 */
let renovacionEnCurso: Promise<boolean> | null = null;

/**
 * Pide un access token nuevo usando la cookie.
 *
 * Los que lleguen mientras hay una renovación en curso se cuelgan de esa misma
 * en vez de empezar otra. Ver arriba.
 */
function renovar(): Promise<boolean> {
  if (!renovacionEnCurso) {
    renovacionEnCurso = pedirTokenNuevo();
    void renovacionEnCurso.finally(() => {
      renovacionEnCurso = null;
    });
  }
  return renovacionEnCurso;
}

/**
 * `credentials: 'include'` es obligatorio: sin eso el navegador no manda la
 * cookie en una petición cross-origin y el refresh falla con 400 sin decir por
 * qué.
 */
async function pedirTokenNuevo(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', [CABECERA_PANEL]: '1' },
      body: '{}',
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string };
    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

/**
 * Recupera la sesión al cargar la página.
 *
 * El access token no se persiste, así que tras un recargo no hay ninguno: se pide
 * uno con la cookie. Si no hay cookie —o venció— devuelve false y el usuario ve
 * el login.
 */
export function restaurarSesion(): Promise<boolean> {
  return renovar();
}

/** Cierra la sesión en el servidor, que es quien puede borrar la cookie. */
export async function cerrarSesionEnServidor(): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        [CABECERA_PANEL]: '1',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: '{}',
    });
  } catch {
    // Si el servidor no responde, igual se limpia del lado del cliente. La
    // cookie queda, pero su fila se revoca en el próximo intento de uso.
  }
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly data: unknown;

  constructor(message: string, status: number, data: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Fetch wrapper con auto-refresh de token.
 *
 * Genérico: T define el tipo del response parseado.
 *   const user = await api<AuthUser>('/auth/me');
 *   const data = await api<Paginated<Appointment>>('/appointments');
 */
export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, headers: customHeaders, method = 'GET' } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const config: RequestInit = {
    method,
    headers,
    // Obligatorio, y no sólo para los endpoints que leen la cookie: sin esto el
    // navegador **tampoco guarda** la que el login devuelve en un `Set-Cookie`
    // cross-origin, y la sesión se cae en el primer refresh sin un error que lo
    // explique. La cookie está acotada a `/api/auth`, así que igual no viaja en
    // las demás peticiones.
    credentials: 'include',
  };
  if (body !== undefined) {
    config.body = JSON.stringify(body);
  }

  let res = await fetch(`${API_URL}${path}`, config);

  // Antes esto sólo se intentaba si había un refresh token guardado. Ahora
  // siempre se intenta: el navegador tiene la cookie o no la tiene, y este código
  // no puede saberlo — que es exactamente el punto.
  //
  // Salvo en las rutas que *establecen* la sesión. Ahí un 401 no significa
  // "venció el access token" sino "estas credenciales no sirven", y renovar no
  // arregla nada: dispara un refresh inútil y, peor, reemplaza el mensaje del
  // servidor por "Sesión expirada". Escribir mal la contraseña decía que la
  // sesión había expirado. Lo encontró una prueba en navegador, no las del
  // backend: el error sólo se ve en la pantalla.
  if (res.status === 401 && !ESTABLECEN_SESION.has(path)) {
    const renovado = await renovar();
    if (renovado && accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${API_URL}${path}`, { ...config, headers });
    }

    if (res.status === 401) {
      clearTokens();
      onAuthError?.();
      throw new ApiError('Sesión expirada', 401);
    }
  }

  const data = (await res.json()) as T;

  if (!res.ok) {
    const errData = data as { error?: string };
    throw new ApiError(errData.error ?? 'Error del servidor', res.status, data);
  }

  return data;
}
