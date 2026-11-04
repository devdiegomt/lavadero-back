/**
 * Lo único de la API que se lee sin sesión: los datos de contacto de un
 * lavadero para su aviso de privacidad (`/privacidad/:slug` en el panel).
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
import { conBypassRls } from '../../shared/middleware/rls';

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

export default router;
