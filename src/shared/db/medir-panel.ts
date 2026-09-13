/**
 * Mide lo que tarda el panel de verdad.
 * Ejecutar: npm run medir
 *
 * RNF-REN-1 dice *"una consulta del panel responde en < 500 ms con 10k turnos"*,
 * y hasta ahora decía **"no medido"**. Un requisito con un número y sin medición
 * es una intención.
 *
 * Recorre los endpoints por HTTP —no las consultas sueltas— porque lo que le
 * importa a quien usa el panel es cuánto tarda la pantalla, no cuánto tarda un
 * `SELECT`. Eso incluye middleware, serialización y, ahora, la evaluación de las
 * políticas de RLS.
 *
 * ## Cómo leer los números
 *
 * Se reporta la **mediana y el p95**, no el promedio: un promedio esconde que
 * una de cada veinte peticiones tarde el triple, y esa es justamente la que el
 * usuario recuerda. Se descartan las primeras corridas, que miden el arranque en
 * frío del planificador y no el uso normal.
 *
 * **Esto no es un benchmark de producción.** Corre contra una base local en la
 * misma máquina, sin red de por medio y sin nadie más usándola. Sirve para
 * comparar entre endpoints y para detectar un plan de consulta malo, que es para
 * lo que se hizo. Los números absolutos en un servidor real serán peores.
 *
 * ## Una respuesta que no es 200 no es una medición
 *
 * La primera versión reportó "los 12 endpoints por debajo de 500 ms" y cuatro de
 * ellos habían devuelto **429**: el limitador global los rechazaba en 1,5 ms y
 * eso se contaba como rapidez. Un verde que no midió nada — el mismo error que
 * este proyecto ya cometió tres veces.
 *
 * Ahora un estado distinto de 200 **invalida** la fila y hace fallar la corrida
 * entera. Y el limitador se sube para medir, porque 12 endpoints × 12 corridas
 * son 144 peticiones contra una cuota de 100.
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../index';
import { queryAdmin, pool } from './index';

// Doce corridas por endpoint dan una mediana estable sin tardar una eternidad.
const CORRIDAS = 12;
const DESCARTE = 2;
/** El presupuesto que fija RNF-REN-1. */
const PRESUPUESTO_MS = 500;

interface Medicion {
  etiqueta: string;
  mediana: number;
  p95: number;
  status: number;
  filas: number | null;
}

function percentil(ordenados: number[], p: number): number {
  const i = Math.min(ordenados.length - 1, Math.floor((ordenados.length - 1) * p));
  return ordenados[i];
}

async function medir(
  etiqueta: string,
  token: string,
  ruta: string,
): Promise<Medicion> {
  const tiempos: number[] = [];
  let status = 0;
  let filas: number | null = null;

  for (let i = 0; i < CORRIDAS; i++) {
    const t0 = process.hrtime.bigint();
    const res = await request(app).get(ruta).set('Authorization', `Bearer ${token}`);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;

    status = res.status;
    if (filas === null) {
      const cuerpo = res.body as { data?: unknown[]; pagination?: { total?: number } };
      filas = cuerpo?.pagination?.total ?? (Array.isArray(cuerpo?.data) ? cuerpo.data.length : null);
    }
    // Las primeras corridas miden el arranque en frío, no el uso normal.
    if (i >= DESCARTE) tiempos.push(ms);
  }

  tiempos.sort((a, b) => a - b);
  return {
    etiqueta,
    mediana: percentil(tiempos, 0.5),
    p95: percentil(tiempos, 0.95),
    status,
    filas,
  };
}

async function main(): Promise<void> {
  try {
    // 12 endpoints × 12 corridas son más peticiones que la cuota global, y un
    // 429 tarda 1,5 ms: sin esto la medición se "aprueba" a sí misma.
    if (!process.env.RATE_LIMIT_MAX) {
      throw new Error(
        'Correr con RATE_LIMIT_MAX alto (el script npm ya lo hace): sin eso el ' +
          'limitador rechaza la mitad de las peticiones y los tiempos no significan nada.',
      );
    }
    const { rows: conteo } = await queryAdmin<{ n: string }>(
      `SELECT count(*)::text AS n FROM appointments`,
    );
    const turnos = parseInt(conteo[0].n, 10);
    console.log(`📊 Midiendo el panel con ${turnos} turnos en la base`);

    const { rows: rol } = await queryAdmin<{ rol: string; bypass: boolean; sup: boolean }>(
      `SELECT current_user AS rol, rolbypassrls AS bypass, rolsuper AS sup
       FROM pg_roles WHERE rolname = current_user`,
    );
    const rlsActivo = !rol[0].bypass && !rol[0].sup;
    console.log(
      `   Rol: ${rol[0].rol} — RLS ${rlsActivo ? 'aplicándose' : 'INERTE (superusuario o BYPASSRLS)'}`,
    );
    if (turnos < 1_000) {
      console.log('   ⚠️  Poca data: correr antes `npm run db:seed-carga`');
    }
    console.log('');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@elbrillante.co', password: 'admin123' });
    const token = (login.body as { accessToken?: string }).accessToken;
    if (!token) throw new Error(`No se pudo iniciar sesión: ${JSON.stringify(login.body)}`);

    const rutas: ReadonlyArray<[string, string]> = [
      ['tablero del día', '/api/appointments/today'],
      ['listado de turnos', '/api/appointments?page=1&limit=20'],
      ['turnos por estado', '/api/appointments?status=pending&page=1&limit=20'],
      ['listado de clientes', '/api/customers?page=1&limit=20'],
      ['buscar cliente', '/api/customers?search=Carga1&page=1&limit=20'],
      ['dashboard', '/api/reports/dashboard?period=month'],
      ['ingresos', '/api/reports/revenue?period=month'],
      ['top servicios', '/api/reports/services?period=month'],
      ['top clientes', '/api/reports/customers?period=month'],
      ['operarios', '/api/reports/operators?period=month'],
      ['pagos', '/api/payments?page=1&limit=30'],
      ['bitácora', '/api/audit?page=1&limit=50'],
    ];

    const resultados: Medicion[] = [];
    for (const [etiqueta, ruta] of rutas) {
      resultados.push(await medir(etiqueta, token, ruta));
    }

    const ancho = Math.max(...resultados.map((r) => r.etiqueta.length));
    console.log(
      `${'endpoint'.padEnd(ancho)}  ${'mediana'.padStart(9)}  ${'p95'.padStart(9)}  estado`,
    );
    console.log('─'.repeat(ancho + 34));

    let excedidos = 0;
    const invalidos: string[] = [];
    for (const r of resultados) {
      const ok = r.status === 200;
      if (!ok) invalidos.push(`${r.etiqueta} → ${r.status}`);
      const marca = !ok
        ? '  ❌ NO MIDIÓ NADA'
        : r.p95 > PRESUPUESTO_MS
          ? '  ⚠️ sobre presupuesto'
          : '';
      if (ok && r.p95 > PRESUPUESTO_MS) excedidos++;
      const filas = r.filas === null ? '' : ` (${r.filas} filas)`;
      console.log(
        `${r.etiqueta.padEnd(ancho)}  ${r.mediana.toFixed(1).padStart(7)}ms  ` +
          `${r.p95.toFixed(1).padStart(7)}ms  ${r.status}${filas}${marca}`,
      );
    }

    console.log('');
    if (invalidos.length > 0) {
      // Un 429 o un 500 se responden rapidísimo. Reportarlos como "por debajo
      // del presupuesto" es peor que no medir: da una respuesta falsa.
      console.error(`❌ ${invalidos.length} endpoints no devolvieron 200, así que no se midieron:`);
      for (const i of invalidos) console.error(`   ${i}`);
      process.exit(1);
    }

    console.log(
      excedidos === 0
        ? `✅ Los ${resultados.length} endpoints por debajo de ${PRESUPUESTO_MS} ms en p95`
        : `⚠️  ${excedidos} de ${resultados.length} por encima de ${PRESUPUESTO_MS} ms en p95`,
    );
    console.log('   Base local, sin red ni concurrencia: los números reales serán peores.');
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) void main();
