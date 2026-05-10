import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Tipo de un route handler async de Express.
 * Los controllers deben cumplir esta firma.
 */
type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void> | Promise<unknown>;

/**
 * Envuelve un route handler async para que Express capture sus rechazos
 * y los pase al middleware de error global sin necesidad de try/catch en
 * cada controller.
 *
 * Uso:
 *   router.get('/users', asyncHandler(ctrl.list));
 *   router.post('/users', validate(schemas.userCreate), asyncHandler(ctrl.create));
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}