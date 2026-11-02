/**
 * El límite global es por usuario cuando hay sesión.
 *
 * Era sólo por IP, y en Render todas las peticiones llegan con la IP del
 * balanceador: la cuota de 100 cada 15 minutos la compartía todo el panel. El
 * Tablero se refresca cada 30 segundos, así que dos tablets con el Tablero
 * abierto la agotaban y todos recibían «Demasiadas solicitudes». Ver
 * shared/middleware/limiteGlobal.ts.
 *
 * Acá todas las peticiones salen de la misma IP —la de supertest—, que es
 * exactamente la situación de producción. Con el límite por IP, la primera
 * prueba falla: el segundo usuario recibe 429 sin haber hecho nada.
 *
 * Se usa una app mínima con un tope de 3 en vez de la app real: con el tope de
 * verdad habría que hacer cientos de peticiones, y las demás suites corren con
 * `RATE_LIMIT_MAX` alto a propósito.
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { config } from '../src/config';
import { claveDelLimite, crearLimiteGlobal } from '../src/shared/middleware/limiteGlobal';

const TOPE = 3;

function appConTope() {
  const app = express();
  app.use(crearLimiteGlobal({ windowMs: 60_000, max: TOPE }));
  app.get('/x', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

function token(sub: string, secreto = config.JWT_SECRET): string {
  return jwt.sign({ sub, tenantId: 't1', role: 'operator', email: `${sub}@x.co` }, secreto, {
    expiresIn: '15m',
  });
}

async function gastar(app: express.Express, auth?: string, veces = TOPE): Promise<number[]> {
  const codigos: number[] = [];
  for (let i = 0; i < veces; i++) {
    const r = request(app).get('/x');
    codigos.push((await (auth ? r.set('Authorization', `Bearer ${auth}`) : r)).status);
  }
  return codigos;
}

describe('límite global por usuario', () => {
  it('un usuario que agota su cuota no deja sin servicio a otro desde la misma IP', async () => {
    const app = appConTope();
    const ana = token('ana');
    const beto = token('beto');

    expect(await gastar(app, ana)).toEqual([200, 200, 200]);
    expect(await gastar(app, ana, 1)).toEqual([429]);

    // La aserción que importa: con el límite por IP esto daba 429.
    expect(await gastar(app, beto, 1)).toEqual([200]);
  });

  it('sin sesión se sigue contando por IP', async () => {
    const app = appConTope();
    expect(await gastar(app, undefined, TOPE + 1)).toEqual([200, 200, 200, 429]);
  });

  it('un token con firma falsa no da cuota propia ni gasta la de otro', async () => {
    const app = appConTope();
    const falso = token('ana', 'un-secreto-que-no-es-el-del-servidor-0123456789abcdef');

    // Cuenta por IP: tres pasan, el cuarto no.
    expect(await gastar(app, falso, TOPE + 1)).toEqual([200, 200, 200, 429]);

    // Y la cuota de la verdadera Ana sigue intacta.
    expect(await gastar(app, token('ana'))).toEqual([200, 200, 200]);
  });

  it('la clave dice de quién es la cuota', () => {
    const conToken = { headers: { authorization: `Bearer ${token('ana')}` }, ip: '10.0.0.1' };
    const sinToken = { headers: {}, ip: '10.0.0.1' };
    const vencido = {
      headers: { authorization: `Bearer ${jwt.sign({ sub: 'ana' }, config.JWT_SECRET, { expiresIn: -10 })}` },
      ip: '10.0.0.1',
    };

    expect(claveDelLimite(conToken as never)).toBe('usuario:ana');
    expect(claveDelLimite(sinToken as never)).toBe('ip:10.0.0.1');
    expect(claveDelLimite(vencido as never)).toBe('ip:10.0.0.1');
  });
});
