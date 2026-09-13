/**
 * Mide la parte del bot que es nuestra.
 * Ejecutar: npm run medir:bot
 *
 * RNF-REN-2 dice *"el bot responde en < 5 s (incluye la llamada a Claude)"* y
 * decía **"no medido; observado ~1-2 s"**. Observado no es medido: es un recuerdo.
 *
 * ## Qué mide y qué no
 *
 * El camino completo de un mensaje es:
 *
 * ```
 * WhatsApp → bot-wa → n8n → [ Claude ] → backend (wa-bridge) → n8n → bot-wa → WhatsApp
 *            ╰──────────── esto ────────────╯
 *                          sólo mide el tramo del backend
 * ```
 *
 * Esto mide **únicamente el tramo del backend**, y conviene decirlo antes que los
 * números: es el único que controlamos y el único que se puede medir acá sin
 * inventar nada.
 *
 * Queda fuera, y no por descuido:
 *
 * | Tramo | Por qué no se mide |
 * |---|---|
 * | **Claude** | Es el término que domina y es de otro. Medirlo acá gastaría crédito y daría el número de esta máquina y este momento, no el de producción |
 * | **n8n** | Su propio tiempo de orquestación se ve en sus ejecuciones, no desde acá |
 * | **WhatsApp** | La entrega del mensaje no la controla nadie de este lado |
 * | **La red** | Todo corre en la misma máquina, sin saltos |
 *
 * Por eso **el resultado no puede decir "RNF-REN-2 se cumple"**. Lo que puede
 * decir es si el backend es o no el problema, que es una pregunta distinta y
 * respondible. Si nuestro tramo son 20 ms de un presupuesto de 5 s, la respuesta
 * a "¿por qué tarda el bot?" no está acá.
 *
 * ## El presupuesto propio
 *
 * `PRESUPUESTO_MS` no son los 5 s del requisito: es lo que nos damos **por
 * mensaje** dentro de ese total. 300 ms deja el 94 % del presupuesto para Claude
 * y la red, que es donde se va de verdad.
 */
import 'dotenv/config';
import request from 'supertest';
import Redis from 'ioredis';
import app from '../../index';
import { queryAdmin, pool } from './index';
import { initBooking } from '../../modules/whatsapp/wa-bridge.booking';

const CORRIDAS = 10;
const DESCARTE = 2;

/** Lo que se da el backend por mensaje, dentro de los 5 s del requisito. */
const PRESUPUESTO_MS = 300;

interface Medicion {
  etiqueta: string;
  mediana: number;
  p95: number;
  status: number;
  /** Si la respuesta fue la esperada. Un 200 con el cuerpo equivocado no sirve. */
  correcta: boolean;
}

function percentil(ordenados: number[], p: number): number {
  const i = Math.min(ordenados.length - 1, Math.floor((ordenados.length - 1) * p));
  return ordenados[i];
}

interface Caso {
  etiqueta: string;
  /** Prepara el estado antes de cada corrida (limpiar la sesión, por ejemplo). */
  antes?: () => Promise<void>;
  hacer: () => Promise<request.Response>;
  /** Qué tiene que traer la respuesta para que la medición valga. */
  esperado: (res: request.Response) => boolean;
}

async function medir(caso: Caso): Promise<Medicion> {
  const tiempos: number[] = [];
  let status = 0;
  let correcta = true;

  for (let i = 0; i < CORRIDAS; i++) {
    if (caso.antes) await caso.antes();

    const t0 = process.hrtime.bigint();
    const res = await caso.hacer();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;

    status = res.status;
    if (!caso.esperado(res)) correcta = false;
    if (i >= DESCARTE) tiempos.push(ms);
  }

  tiempos.sort((a, b) => a - b);
  return {
    etiqueta: caso.etiqueta,
    mediana: percentil(tiempos, 0.5),
    p95: percentil(tiempos, 0.95),
    status,
    correcta,
  };
}

async function main(): Promise<void> {
  let redis: Redis | null = null;

  try {
    // El límite del bridge son 120 peticiones por cliente cada 15 min, y esto
    // manda varios cientos. Un 429 se responde en 1,5 ms y se contaría como
    // rapidez — el mismo error que ya se cometió midiendo el panel.
    if (!process.env.WA_BRIDGE_RATE_LIMIT_MAX) {
      throw new Error(
        'Correr con WA_BRIDGE_RATE_LIMIT_MAX alto (el script npm ya lo hace): sin eso ' +
          'el limitador rechaza la mayoría y los tiempos no significan nada.',
      );
    }

    if (!process.env.REDIS_URL) {
      throw new Error('Sin REDIS_URL no hay agendamiento que medir: es donde vive la sesión.');
    }
    redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
    initBooking(redis);

    const { rows: t } = await queryAdmin<{ id: string; whatsapp_phone: string }>(
      `SELECT id, whatsapp_phone FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
    );
    if (!t[0]) throw new Error('Falta el tenant del seed. Correr: npm run db:reset');
    const tenantPhone = t[0].whatsapp_phone;

    const { rows: veh } = await queryAdmin<{ plate: string }>(
      `SELECT plate FROM vehicles WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [t[0].id],
    );
    if (!veh[0]) throw new Error('El tenant no tiene vehículos. Correr: npm run db:seed');
    const placa = veh[0].plate;

    const { rows: conteo } = await queryAdmin<{ n: string }>(
      `SELECT count(*)::text AS n FROM appointments WHERE tenant_id = $1`, [t[0].id],
    );
    const { rows: rol } = await queryAdmin<{ rol: string; bypass: boolean; sup: boolean }>(
      `SELECT current_user AS rol, rolbypassrls AS bypass, rolsuper AS sup
       FROM pg_roles WHERE rolname = current_user`,
    );

    console.log(`📊 Midiendo el tramo del backend con ${conteo[0].n} turnos en la base`);
    console.log(
      `   Rol: ${rol[0].rol} — RLS ${!rol[0].bypass && !rol[0].sup ? 'aplicándose' : 'INERTE'}`,
    );
    console.log('   NO incluye Claude, n8n, WhatsApp ni la red. Ver la cabecera del archivo.');
    console.log('');

    const bridge = (ruta: string) =>
      request(app)
        .post(`/api/wa-bridge${ruta}`)
        .set('x-api-key', process.env.N8N_API_KEY ?? '')
        .set('x-tenant-phone', tenantPhone);

    const consulta = (ruta: string) =>
      request(app)
        .get(`/api/wa-bridge${ruta}`)
        .set('x-api-key', process.env.N8N_API_KEY ?? '')
        .set('x-tenant-phone', tenantPhone);

    /** Un LID distinto por caso: el límite y la sesión se llavean por cliente. */
    const lid = (n: string) => `medir-${n}-${Date.now()}@lid`;

    const casos: Caso[] = [
      {
        etiqueta: 'consultar estado por placa',
        hacer: () => consulta(`/appointment-status?plate=${placa}`),
        esperado: (r) => r.status === 200 && typeof r.body.found === 'boolean',
      },
      {
        etiqueta: 'listar servicios y precios',
        hacer: () => consulta('/services'),
        esperado: (r) => r.status === 200 && Array.isArray(r.body.services),
      },
      {
        etiqueta: 'historial del cliente',
        hacer: () => consulta(`/customer-history?waLid=${encodeURIComponent(lid('hist'))}`),
        esperado: (r) => r.status === 200 && typeof r.body.found === 'boolean',
      },
      {
        etiqueta: 'auditar un mensaje',
        hacer: () =>
          bridge('/log').send({
            waLid: lid('log'),
            direction: 'inbound',
            content: 'hola, cuánto cuesta el lavado',
            flowStep: 'list_services',
          }),
        esperado: (r) => r.status === 201,
      },
      {
        // El más importante: n8n lo llama en CADA mensaje, antes que a Claude,
        // para saber si hay una conversación en curso. Es el que más veces se
        // ejecuta de todo el sistema.
        etiqueta: 'booking-step sin conversación',
        hacer: () => bridge('/booking-step').send({ waLid: lid('sin'), message: 'hola' }),
        esperado: (r) => r.status === 200 && r.body.active === false,
      },
    ];

    const resultados: Medicion[] = [];
    for (const caso of casos) resultados.push(await medir(caso));

    // ── La conversación completa, paso por paso ──
    //
    // Se mide cada paso por separado y no el total: lo que el cliente espera es
    // cada respuesta, no la suma. Un paso de 2 s arruina la conversación aunque
    // los otros cinco sean instantáneos.
    const pasos: ReadonlyArray<[string, string, boolean]> = [
      ['agendar · arranque', '', true],
      ['agendar · placa', placa, false],
      ['agendar · servicio', '1', false],
      ['agendar · día', '1', false],
      ['agendar · hora', '1', false],
      ['agendar · confirmar', 'SI', false],
    ];

    for (let i = 0; i < pasos.length; i++) {
      const [etiqueta] = pasos[i];
      let cliente = '';

      resultados.push(
        await medir({
          etiqueta,
          // Cada corrida arranca una conversación nueva y la lleva hasta el paso
          // anterior, para medir ese paso y no el estado que dejó el anterior.
          antes: async () => {
            cliente = lid(`conv${i}-${Math.random().toString(36).slice(2, 8)}`);
            for (let j = 0; j < i; j++) {
              const [, msg, start] = pasos[j];
              await bridge('/booking-step').send({ waLid: cliente, message: msg, start });
            }
          },
          hacer: () => {
            const [, msg, start] = pasos[i];
            return bridge('/booking-step').send({ waLid: cliente, message: msg, start });
          },
          esperado: (r) => r.status === 200 && r.body.active === true,
        }),
      );
    }

    // ── Informe ──
    const ancho = Math.max(...resultados.map((r) => r.etiqueta.length));
    console.log(`${'paso'.padEnd(ancho)}  ${'mediana'.padStart(9)}  ${'p95'.padStart(9)}`);
    console.log('─'.repeat(ancho + 30));

    const invalidos: string[] = [];
    let excedidos = 0;

    for (const r of resultados) {
      if (!r.correcta) invalidos.push(`${r.etiqueta} (estado ${r.status})`);
      const marca = !r.correcta
        ? '  ❌ NO MIDIÓ NADA'
        : r.p95 > PRESUPUESTO_MS
          ? '  ⚠️ sobre presupuesto'
          : '';
      if (r.correcta && r.p95 > PRESUPUESTO_MS) excedidos++;
      console.log(
        `${r.etiqueta.padEnd(ancho)}  ${r.mediana.toFixed(1).padStart(7)}ms  ` +
          `${r.p95.toFixed(1).padStart(7)}ms${marca}`,
      );
    }

    console.log('');
    if (invalidos.length > 0) {
      // Una respuesta equivocada se devuelve tan rápido como una buena. Contarla
      // como rapidez es peor que no medir.
      console.error(`❌ ${invalidos.length} casos no dieron la respuesta esperada:`);
      for (const i of invalidos) console.error(`   ${i}`);
      process.exit(1);
    }

    const peor = Math.max(...resultados.map((r) => r.p95));
    console.log(
      excedidos === 0
        ? `✅ Los ${resultados.length} pasos por debajo de ${PRESUPUESTO_MS} ms en p95 (peor: ${peor.toFixed(1)} ms)`
        : `⚠️  ${excedidos} de ${resultados.length} por encima de ${PRESUPUESTO_MS} ms en p95`,
    );
    console.log('');
    console.log(
      `   Esto es el tramo del backend. Del presupuesto de 5 s de RNF-REN-2 quedan\n` +
        `   ~${((5000 - peor) / 1000).toFixed(1)} s para Claude, n8n, WhatsApp y la red — que es donde se va.`,
    );
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    if (redis) await redis.quit();
    await pool.end();
  }
}

if (require.main === module) void main();
