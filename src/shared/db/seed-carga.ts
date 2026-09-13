/**
 * Datos de carga para medir, no para demostrar.
 * Ejecutar: npm run db:seed-carga [turnos]
 *
 * `db:demo` carga un puñado de filas: sirve para ver el panel con algo adentro,
 * no para saber si aguanta. RNF-REN-1 dice *"una consulta del panel responde en
 * < 500 ms con 10k turnos"* y hasta ahora estaba marcado **"no medido"** — una
 * afirmación sobre el sistema que nadie había comprobado.
 *
 * Esto genera ese volumen para poder medirlo de verdad.
 *
 * ## Qué tan realistas son los datos
 *
 * Lo suficiente para que el plan de consulta se parezca al de producción, que es
 * lo único que importa acá:
 *
 * - **Los turnos se reparten sobre dos años hacia atrás**, con más densidad en
 *   los últimos meses. Meterlos todos en un día haría que los índices por fecha
 *   se vieran mucho mejor de lo que son.
 * - **El estado depende de la fecha del turno**, no del azar: lo viejo está
 *   entregado o cancelado, y sólo los últimos días tienen trabajo en curso. Un
 *   `WHERE status IN ('pending','in_progress')` sobre miles de turnos
 *   «pendientes» de hace un año mide un lavadero que no existe.
 * - **Los clientes tienen visitas desparejas**: unos pocos concentran muchos
 *   turnos y la mayoría tiene uno o dos, que es como se comporta un lavadero.
 *
 * Lo que **no** intenta ser es realista en el contenido: los nombres son
 * generados y las placas son secuenciales. Para medir un plan de consulta da
 * igual, y datos personales inventados con apariencia real son una mala idea
 * incluso en desarrollo.
 */
import 'dotenv/config';
import { queryAdmin, pool } from './index';

const TURNOS_POR_DEFECTO = 10_000;

/**
 * El estado depende de **cuándo** fue el turno, no del azar.
 *
 * La primera versión los repartía al azar sobre los dos años, y eso dejaba 6.572
 * turnos `pending` o `in_progress` **de hace más de un mes**. Ningún lavadero
 * tiene eso: un turno de hace seis meses está entregado o cancelado, nunca
 * pendiente.
 *
 * No era un detalle cosmético. La consulta de "¿ya está mi carro?" filtra por
 * `status IN ('pending','in_progress')`, así que con 7.000 turnos activos el
 * planificador elegía recorrerlos todos y la consulta tardaba **60 ms** en vez
 * de 5. Se estuvo a punto de "optimizar" una consulta que no tenía nada malo.
 *
 * Es la segunda vez que este generador produce un número engañoso por no
 * parecerse a la realidad. La primera fue la distribución de fechas.
 */
function estadoSegun(diasAtras: number): string {
  const r = Math.random();

  // Lo viejo está cerrado. Un turno de la semana pasada ya se entregó o se
  // canceló; no puede seguir "en proceso".
  if (diasAtras > 2) return r < 0.9 ? 'delivered' : 'cancelled';

  // Los últimos días son los que tienen trabajo en curso.
  if (r < 0.45) return 'delivered';
  if (r < 0.60) return 'done';
  if (r < 0.75) return 'in_progress';
  if (r < 0.92) return 'pending';
  return 'cancelled';
}

/**
 * Días hacia atrás, con un sesgo leve hacia lo reciente.
 *
 * La primera versión usaba `random() ** 2`, pensando que concentrar en lo
 * reciente haría la medición más exigente. Hizo lo contrario: con 100.000 turnos
 * dejaba **3.776 en el día de hoy**, y el tablero del día —la pantalla que el
 * personal mira todo el tiempo— se medía contra un día que ningún lavadero tiene.
 * El resultado parecía malo (106 ms) y no significaba nada.
 *
 * Con `** 1.2` el reparto es casi uniforme: 100.000 turnos sobre dos años dan
 * unos 140 por día, que ya es un lavadero muy ocupado. **Unos datos de prueba
 * poco realistas miden un sistema que no existe**, y da igual si el número sale
 * alto o bajo.
 */
function diasAtras(rango: number): number {
  return Math.floor(Math.pow(Math.random(), 1.2) * rango);
}

async function cargar(cuantos: number): Promise<void> {
  const { rows: t } = await queryAdmin<{ id: string }>(
    `SELECT id FROM tenants WHERE slug = 'el-brillante' LIMIT 1`,
  );
  if (!t[0]) throw new Error('Falta el tenant del seed. Correr primero: npm run db:seed');
  const tenantId = t[0].id;

  const { rows: servicios } = await queryAdmin<{ id: string; price_sedan: number }>(
    `SELECT id, price_sedan FROM services WHERE tenant_id = $1`, [tenantId],
  );
  if (servicios.length === 0) throw new Error('El tenant no tiene servicios');

  const { rows: usuarios } = await queryAdmin<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id = $1`, [tenantId],
  );

  // Un cliente cada ~6 turnos: deja a unos con muchas visitas y a la mayoría
  // con una o dos, que es la forma real de la tabla.
  const cuantosClientes = Math.max(50, Math.floor(cuantos / 6));

  console.log(`🔄 Generando ${cuantosClientes} clientes y ${cuantos} turnos...`);

  // ── Clientes y vehículos, en lotes ──
  const { rows: clientesYa } = await queryAdmin<{ n: string }>(
    `SELECT count(*)::text AS n FROM customers WHERE tenant_id = $1`, [tenantId],
  );
  const desplazamientoClientes = parseInt(clientesYa[0].n, 10);

  const clientes: string[] = [];
  const LOTE = 500;
  for (let base = 0; base < cuantosClientes; base += LOTE) {
    const n = Math.min(LOTE, cuantosClientes - base);
    const valores: string[] = [];
    const params: unknown[] = [tenantId];
    for (let i = 0; i < n; i++) {
      const idx = desplazamientoClientes + base + i;
      const p = params.length;
      // Teléfonos fuera del rango real (+57 3 + 9 dígitos) para que no colisionen
      // con nadie: empiezan por 39, que no es un celular colombiano válido.
      params.push(`Carga${idx}`, `Apellido${idx}`, `+5739${String(idx).padStart(8, '0')}`);
      valores.push(`($1, $${p + 1}, $${p + 2}, $${p + 3}, NOW(), 'v1-carga', 'panel')`);
    }
    const { rows } = await queryAdmin<{ id: string }>(
      `INSERT INTO customers (tenant_id, first_name, last_name, phone, consent_at, consent_version, consent_source)
       VALUES ${valores.join(',')} RETURNING id`,
      params as never,
    );
    clientes.push(...rows.map((r) => r.id));
  }

  // Las placas se generan a partir de un índice, así que correr esto dos veces
  // sin resetear las repetía y chocaba contra el índice único. Se arranca desde
  // las que ya existen.
  const { rows: yaHay } = await queryAdmin<{ n: string }>(
    `SELECT count(*)::text AS n FROM vehicles WHERE tenant_id = $1`, [tenantId],
  );
  const desplazamiento = parseInt(yaHay[0].n, 10);

  const vehiculos: { id: string; customer_id: string }[] = [];
  for (let base = 0; base < clientes.length; base += LOTE) {
    const trozo = clientes.slice(base, base + LOTE);
    const valores: string[] = [];
    const params: unknown[] = [tenantId];
    trozo.forEach((cid, i) => {
      const idx = desplazamiento + base + i;
      const p = params.length;
      // Placa colombiana válida: 3 letras + 3 dígitos, sin repetir.
      const letras =
        String.fromCharCode(65 + (Math.floor(idx / 676) % 26)) +
        String.fromCharCode(65 + (Math.floor(idx / 26) % 26)) +
        String.fromCharCode(65 + (idx % 26));
      params.push(cid, `${letras}${String(idx % 1000).padStart(3, '0')}`);
      valores.push(`($1, $${p + 1}, $${p + 2}, 'sedan')`);
    });
    const { rows } = await queryAdmin<{ id: string; customer_id: string }>(
      `INSERT INTO vehicles (tenant_id, customer_id, plate, vehicle_type)
       VALUES ${valores.join(',')} RETURNING id, customer_id`,
      params as never,
    );
    vehiculos.push(...rows);
  }

  // ── Turnos ──
  const RANGO_DIAS = 730;
  let creados = 0;
  for (let base = 0; base < cuantos; base += LOTE) {
    const n = Math.min(LOTE, cuantos - base);
    const valores: string[] = [];
    const params: unknown[] = [tenantId];

    for (let i = 0; i < n; i++) {
      const veh = vehiculos[Math.floor(Math.random() * vehiculos.length)];
      const srv = servicios[Math.floor(Math.random() * servicios.length)];
      const hora = 7 + Math.floor(Math.random() * 12);
      const minuto = Math.random() < 0.5 ? '00' : '30';
      const asignado =
        usuarios.length > 0 && Math.random() < 0.7
          ? usuarios[Math.floor(Math.random() * usuarios.length)].id
          : null;

      const dias = diasAtras(RANGO_DIAS);
      const p = params.length;
      params.push(
        veh.customer_id, veh.id, srv.id,
        String(dias), `${String(hora).padStart(2, '0')}:${minuto}`,
        srv.price_sedan, estadoSegun(dias), asignado,
      );
      valores.push(
        `($1, $${p + 1}, $${p + 2}, $${p + 3},` +
          ` (CURRENT_DATE - ($${p + 4} || ' days')::interval)::date, $${p + 5},` +
          ` $${p + 6}, $${p + 7}, $${p + 8}, 'walk_in')`,
      );
    }

    await queryAdmin(
      `INSERT INTO appointments
         (tenant_id, customer_id, vehicle_id, service_id, scheduled_date, scheduled_time,
          price, status, assigned_to, source)
       VALUES ${valores.join(',')}`,
      params as never,
    );
    creados += n;
    if (creados % 2_000 === 0) console.log(`   ${creados}/${cuantos}`);
  }

  // `visit_count` y `last_visit_at` son denormalizaciones que el panel lee. Si
  // quedaran en cero, las consultas que ordenan por visitas medirían un caso que
  // no existe.
  await queryAdmin(
    `UPDATE customers c SET
       visit_count = sub.n,
       last_visit_at = sub.ultima
     FROM (
       SELECT customer_id, count(*) AS n, max(scheduled_date) AS ultima
       FROM appointments WHERE tenant_id = $1 GROUP BY customer_id
     ) sub
     WHERE c.id = sub.customer_id`,
    [tenantId],
  );

  // Sin esto el planificador trabaja con estadísticas de una tabla vacía y los
  // tiempos medidos no significan nada.
  console.log('🔄 ANALYZE...');
  await queryAdmin('ANALYZE appointments, customers, vehicles');

  const { rows: conteo } = await queryAdmin<{ tabla: string; n: string }>(
    `SELECT 'appointments' AS tabla, count(*)::text AS n FROM appointments
     UNION ALL SELECT 'customers', count(*)::text FROM customers
     UNION ALL SELECT 'vehicles', count(*)::text FROM vehicles`,
  );

  console.log('✅ Carga lista');
  for (const c of conteo) console.log(`   ${c.tabla}: ${c.n}`);
}

async function main(): Promise<void> {
  const cuantos = parseInt(process.argv[2] ?? '', 10) || TURNOS_POR_DEFECTO;
  try {
    await cargar(cuantos);
  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) void main();

export { cargar };
