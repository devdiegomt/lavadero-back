/**
 * Lo que la API atiende sin sesión, siempre acotado a un lavadero por su slug:
 *
 * - Los datos de contacto para su aviso de privacidad (`/privacidad/:slug`).
 * - Su página de reservas (`/reservar/:slug`): ver `reservas.ts`.
 *
 * ## El aviso de privacidad
 *
 * El Decreto 1377 de 2013 (art. 15) exige que el aviso diga quién es el
 * responsable del tratamiento y cómo contactarlo. El responsable de los datos
 * de los clientes de un lavadero es **el lavadero**, no Qlarity, así que el
 * aviso tiene que mostrar su nombre, su NIT y su contacto. Son datos del
 * negocio que el lavadero dio al registrarse para eso, y nada más sale de acá:
 * ni clientes, ni usuarios, ni plan.
 *
 * Es un cuarto camino con bypass de RLS —no hay tenant que fijar: justamente se
 * busca por slug—, acotado a una consulta de columnas fijas. Ver
 * docs/05-seguridad.md §3.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { conBypassRls, abrirContextoPorSlug } from '../../shared/middleware/rls';
import { validate } from '../../shared/middleware/validate';
import { datosParaReservar, horarios, reservar, esquemaReserva } from './reservas';

const router = Router();

interface DatosPublicos {
  name: string;
  owner_name: string | null;
  nit: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
}

router.get(
  '/lavaderos/:slug',
  conBypassRls('público: contacto del lavadero para su aviso de privacidad'),
  asyncHandler(async (req: Request, res: Response) => {
    const slug = String(req.params.slug).toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw new AppError('Lavadero no encontrado', 404);

    const { rows } = await db.query<DatosPublicos>(
      `SELECT name, owner_name, nit, address, city, phone, email
         FROM tenants WHERE slug = $1 AND is_active = true`,
      [slug],
    );
    if (rows.length === 0) throw new AppError('Lavadero no encontrado', 404);

    const t = rows[0];
    res.json({
      nombre: t.name,
      razonSocial: t.owner_name,
      nit: t.nit,
      direccion: t.address,
      ciudad: t.city,
      telefono: t.phone,
      correo: t.email,
    });
  }),
);

// ─── Reservas ────────────────────────────────────────────────────────────────
// Sin bypass: `abrirContextoPorSlug` usa la puerta de atrás sólo para traducir
// el slug a un tenant, y después todo pasa por RLS como en el panel.
router.get('/lavaderos/:slug/reservas', abrirContextoPorSlug, asyncHandler(datosParaReservar));
router.get('/lavaderos/:slug/reservas/horarios', abrirContextoPorSlug, asyncHandler(horarios));
router.post(
  '/lavaderos/:slug/reservas',
  validate(esquemaReserva),
  abrirContextoPorSlug,
  asyncHandler(reservar),
);

export default router;
