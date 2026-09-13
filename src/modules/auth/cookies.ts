/**
 * El refresh token vive en una cookie `httpOnly`, no en `localStorage`.
 *
 * ## Qué cambia y por qué
 *
 * Antes los dos tokens se guardaban en `localStorage`, que es legible por
 * cualquier JavaScript de la página. Un XSS —una dependencia comprometida, un
 * texto sin escapar— se llevaba el refresh token, y con él **siete días de
 * sesión renovable** que sobreviven al cierre del navegador y a un cambio de
 * contraseña hasta que alguien revoque.
 *
 * Ahora:
 *
 * - **Refresh token**: cookie `httpOnly`. El JavaScript de la página no la puede
 *   leer, ni siquiera el propio. Sólo viaja al endpoint que la necesita.
 * - **Access token**: en memoria del frontend, sin persistir. Un XSS lo puede
 *   robar, pero dura 15 minutos y no se puede renovar sin la cookie. Se pasa de
 *   "sesión comprometida indefinidamente" a "quince minutos".
 *
 * ## Por qué esto no fue el proyecto de CSRF que parecía
 *
 * La brecha estaba anotada como *"Alto (implica cookies httpOnly y CSRF)"*, y esa
 * estimación asumía mover **los dos** tokens a cookies. Si la autenticación de
 * cada petición viajara en una cookie, el navegador la adjuntaría sola en
 * cualquier petición que un sitio ajeno provoque, y haría falta un token CSRF en
 * las 80 rutas.
 *
 * Dejando el access token en un header, **las rutas que cambian algo quedan
 * inmunes por construcción**: el navegador nunca adjunta `Authorization` por su
 * cuenta. La superficie de CSRF se reduce a los dos endpoints que sí usan la
 * cookie —`refresh` y `logout`—, y eso se cubre acá.
 */
import type { Request, Response, NextFunction } from 'express';
import { config } from '../../config';
import { AppError } from '../../shared/middleware/errorHandler';

export const NOMBRE_COOKIE = 'refresh_token';

/**
 * Cabecera que tienen que mandar `refresh` y `logout`.
 *
 * Es la defensa contra CSRF en los dos únicos endpoints que se autentican con
 * cookie. Funciona porque:
 *
 * - Un `<form>` de un sitio ajeno **no puede** poner cabeceras propias.
 * - Un `fetch` cross-origin que sí las pone dispara un preflight CORS, y el
 *   origen permitido es uno solo.
 *
 * Va además de `SameSite`, no en lugar de. `SameSite=Lax` ya bloquea el POST
 * cross-site, pero un despliegue con el panel y la API en dominios distintos
 * necesita `SameSite=None`, y entonces esto es lo único que queda.
 */
export const CABECERA_INTENCION = 'x-panel-request';

/** 7 días, lo mismo que `expires_at` de la fila en `refresh_tokens`. */
const VIDA_MS = 7 * 24 * 60 * 60 * 1_000;

function opcionesCookie(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    // Sin `secure` la cookie viaja en claro por HTTP. En desarrollo hace falta
    // que sea false porque no hay TLS en localhost.
    secure: config.NODE_ENV === 'production',
    sameSite: config.AUTH_COOKIE_SAMESITE,
    // Acotada a las rutas que la usan: no se manda en cada petición al API, así
    // que tampoco se expone en cada una.
    path: '/api/auth',
    maxAge: VIDA_MS,
  };
}

export function ponerRefreshEnCookie(res: Response, token: string): void {
  res.cookie(NOMBRE_COOKIE, token, opcionesCookie());
}

export function borrarRefreshCookie(res: Response): void {
  // Mismas opciones de `path` y `sameSite`: el navegador no borra una cookie si
  // no coinciden, y el síntoma sería un logout que no cierra la sesión.
  res.clearCookie(NOMBRE_COOKIE, { ...opcionesCookie(), maxAge: undefined } as never);
}

/**
 * Lee el refresh token de la cookie.
 *
 * Express no parsea cookies por su cuenta y `cookie-parser` es una dependencia
 * entera para leer **una**. Son diez líneas; la decisión fue no agregarla.
 */
export function refreshDeLaCookie(req: Request): string | null {
  const cabecera = req.headers.cookie;
  if (!cabecera) return null;

  for (const parte of cabecera.split(';')) {
    const sep = parte.indexOf('=');
    if (sep === -1) continue;
    if (parte.slice(0, sep).trim() !== NOMBRE_COOKIE) continue;
    try {
      return decodeURIComponent(parte.slice(sep + 1).trim()) || null;
    } catch {
      // Una cookie mal codificada es basura, no un token.
      return null;
    }
  }
  return null;
}

/**
 * De dónde sale el refresh token, en orden.
 *
 * El cuerpo sigue aceptándose para que un frontend viejo no quede sin sesión
 * durante el despliegue. Es transición, no diseño: lo correcto es la cookie, y
 * `AUTH_REFRESH_IN_BODY` controla si el login además lo devuelve en el cuerpo.
 */
export function leerRefreshToken(req: Request): string | null {
  const deCookie = refreshDeLaCookie(req);
  if (deCookie) return deCookie;

  const { refreshToken } = (req.body ?? {}) as { refreshToken?: unknown };
  return typeof refreshToken === 'string' && refreshToken !== '' ? refreshToken : null;
}

/**
 * Exige la cabecera de intención en los endpoints que se autentican con cookie.
 *
 * Ver `CABECERA_INTENCION`. Sólo se aplica cuando la petición **viene con la
 * cookie**: si el token llega en el cuerpo, quien lo manda ya lo tenía y no hay
 * nada que un sitio ajeno pueda provocar.
 */
export function exigirIntencionDelPanel(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const usaCookie = refreshDeLaCookie(req) !== null;
  if (!usaCookie) return next();

  if (req.headers[CABECERA_INTENCION] === undefined) {
    throw new AppError(
      `Falta la cabecera ${CABECERA_INTENCION}. Las peticiones que usan la cookie de ` +
        'sesión tienen que declararse explícitamente.',
      403,
    );
  }
  next();
}
