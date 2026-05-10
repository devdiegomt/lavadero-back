/**
 * Augmentación del tipo Request de Express.
 *
 * Los middlewares `authenticate` y `requireTenant` inyectan estas
 * propiedades. Al declararlas aquí, TypeScript las reconoce en
 * todos los controllers sin necesidad de casts manuales.
 *
 * Uso típico en un controller:
 *   async function list(req: Request, res: Response): Promise<void> {
 *     const { tenantId } = req;         // string — garantizado por requireTenant
 *     const { user }     = req;         // definido por authenticate
 *   }
 */

import type { UserRole } from './entities';

declare global {
  namespace Express {
    interface Request {
      /**
       * Payload del JWT, inyectado por `authenticate`.
       * Es `undefined` en rutas públicas (onboarding/register, health).
       */
      user?: {
        id: string;
        tenantId: string | null;  // null para super_admin
        role: UserRole;
        email: string;
      };

      /**
       * ID del tenant activo, inyectado por `requireTenant`.
       * Garantiza que el controller siempre tiene un tenant válido.
       * Solo está definido en rutas protegidas con requireTenant.
       */
      tenantId?: string;
    }
  }
}

// Necesario para que TypeScript trate este archivo como módulo y no como script global.
export {};