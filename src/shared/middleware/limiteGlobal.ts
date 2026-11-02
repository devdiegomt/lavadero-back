/**
 * El límite global de peticiones: por usuario cuando hay sesión, por IP cuando no.
 *
 * Era sólo por IP, y en producción la IP no es la del usuario. El servidor no
 * declara `trust proxy`, así que detrás del balanceador de Render `req.ip` es
 * la del balanceador: **la misma para todos**. Las 100 peticiones cada 15
 * minutos se repartían entre todos los que usaran el panel a la vez.
 *
 * Y el panel las gasta solo: el Tablero se refresca cada 30 segundos. Dos
 * tablets con el Tablero abierto ya pasan de 100 en 15 minutos, y a partir de
 * ahí todos —también quien está entrando— reciben «Demasiadas solicitudes».
 *
 * Es el mismo error que ya tuvo `wa-bridge` (ver wa-bridge-limite.test.ts):
 * una cuota que parece individual y la comparte todo el mundo.
 *
 * ## Por qué por usuario y no arreglando la IP
 *
 * `trust proxy` haría que `req.ip` saliera de `X-Forwarded-For`, pero cuántos
 * saltos hay que confiar depende de lo que haya delante —Render solo, Render
 * detrás de Vercel—, y con un número mal puesto cualquiera elige su IP
 * escribiendo esa cabecera. El usuario del token, en cambio, no depende de la
 * infraestructura: el token va firmado.
 *
 * Por eso **se verifica la firma**. Leer el `sub` sin verificar dejaría a
 * cualquiera inventarse un token para gastar la cuota de otro usuario, o para
 * tener una cuota nueva en cada petición. Un token que no verifica cuenta por
 * IP, como si no hubiera token.
 *
 * Lo que sigue compartido: las peticiones sin sesión —login, refresh, salud—.
 * Son pocas: un login por persona y un refresh cada 15 minutos. El login
 * además tiene su propio límite por email (auth.routes.ts).
 */
import jwt from 'jsonwebtoken';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request } from 'express';
import { config } from '../../config';
import type { JwtPayload } from '../../types/api';

/** La clave con la que se cuenta una petición. Exportada para las pruebas. */
export function claveDelLimite(req: Request): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), config.JWT_SECRET) as JwtPayload;
      if (payload.sub) return `usuario:${payload.sub}`;
    } catch {
      // Firma inválida o token vencido: cuenta por IP. Un token vencido igual
      // va a recibir un 401 más adelante; acá sólo importa no darle cuota propia.
    }
  }
  return `ip:${req.ip ?? 'desconocida'}`;
}

export function crearLimiteGlobal(opciones: { windowMs: number; max: number }): RateLimitRequestHandler {
  return rateLimit({
    windowMs: opciones.windowMs,
    max: opciones.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: claveDelLimite,
    message: {
      error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.',
    },
  });
}
