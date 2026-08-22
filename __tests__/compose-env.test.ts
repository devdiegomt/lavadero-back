/**
 * El compose tiene que pasarle al backend todas las variables que config.ts
 * exige sin default.
 *
 * Cuando falta una, config.ts aborta al arrancar, el contenedor nunca queda
 * arriba y "backend" deja de resolver dentro de la red de Docker. Lo que se
 * ve entonces no es "falta ENCRYPTION_KEY" sino un error de DNS en n8n, tres
 * ramas del bot respondiendo vacío y ninguna pista del origen. Pasó
 * exactamente así: faltaban ENCRYPTION_KEY, SUPER_ADMIN_EMAIL y
 * SUPER_ADMIN_PASSWORD.
 *
 * Es un chequeo estático: no levanta Docker ni importa config.ts (que llama
 * a process.exit cuando el entorno no valida).
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');

/** Variables que el compose le pasa al servicio backend. */
function varsDelCompose(): Set<string> {
  const yml = readFileSync(join(RAIZ, 'docker-compose.yml'), 'utf8');

  // Recortar el bloque environment: del servicio backend sin depender de un
  // parser de YAML (no es dependencia del proyecto).
  const backend = yml.indexOf('\n  backend:');
  expect(backend).toBeGreaterThan(-1);
  const env = yml.indexOf('environment:', backend);
  const finBloque = yml.indexOf('\n    ports:', env);
  const bloque = yml.slice(env, finBloque === -1 ? undefined : finBloque);

  const nombres = new Set<string>();
  for (const linea of bloque.split('\n')) {
    const m = linea.match(/^\s{6}([A-Z][A-Z0-9_]*):/);
    if (m) nombres.add(m[1]);
  }
  return nombres;
}

/** Variables que config.ts exige: sin .default() ni .optional(). */
function varsObligatorias(): string[] {
  const src = readFileSync(join(RAIZ, 'src/config.ts'), 'utf8');
  const inicio = src.indexOf('z.object({');
  expect(inicio).toBeGreaterThan(-1);
  const esquema = src.slice(inicio);

  const obligatorias: string[] = [];
  const lineas = esquema.split('\n');

  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^\s{2}([A-Z][A-Z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    const [, nombre, resto] = m;

    // La definición puede ocupar varias líneas: juntar hasta la que cierra.
    let def = resto;
    let j = i;
    while (!/,\s*$/.test(def.trim()) && j + 1 < lineas.length && j - i < 12) {
      j++;
      def += ' ' + lineas[j].trim();
      if (/^\s{2}[A-Z][A-Z0-9_]*:/.test(lineas[j])) break;
    }

    if (/\.optional\(\)|\.default\(/.test(def)) continue;
    obligatorias.push(nombre);
  }
  return obligatorias;
}

describe('docker-compose: entorno del backend', () => {
  it('pasa todas las variables que config.ts exige', () => {
    const enCompose = varsDelCompose();
    const requeridas = varsObligatorias();

    // Si esto queda vacío el test no está probando nada.
    expect(requeridas.length).toBeGreaterThan(3);

    const faltantes = requeridas.filter((v) => !enCompose.has(v));
    expect({ faltantes }).toEqual({ faltantes: [] });
  });

  it('incluye las tres que rompieron el arranque', () => {
    const enCompose = varsDelCompose();
    for (const v of ['ENCRYPTION_KEY', 'SUPER_ADMIN_EMAIL', 'SUPER_ADMIN_PASSWORD']) {
      expect(enCompose.has(v)).toBe(true);
    }
  });

  it('.env.example documenta cada variable obligatoria', () => {
    const ejemplo = readFileSync(join(RAIZ, '.env.example'), 'utf8');
    const documentadas = new Set(
      ejemplo
        .split('\n')
        .map((l) => l.match(/^\s*([A-Z][A-Z0-9_]*)=/)?.[1])
        .filter(Boolean) as string[],
    );
    const sinDocumentar = varsObligatorias().filter((v) => !documentadas.has(v));
    expect({ sinDocumentar }).toEqual({ sinDocumentar: [] });
  });
});

describe('Dockerfile: rutas que copia', () => {
  // Un COPY cuyo glob no matchea ningún archivo rompe el build de BuildKit.
  // Pasó al migrar src/shared/db a TypeScript: el Dockerfile seguía copiando
  // *.js y el build sólo funcionaba mientras Docker reusara la capa cacheada.
  const dockerfiles = [
    ['backend', 'Dockerfile', RAIZ],
    ['bot-wa', join('bot-wa', 'Dockerfile'), join(RAIZ, 'bot-wa')],
  ] as const;

  it.each(dockerfiles)('%s: cada COPY del contexto matchea algo', (_n, ruta, contexto) => {
    const contenido = readFileSync(join(RAIZ, ruta), 'utf8');
    const sinCoincidencias: string[] = [];

    for (const linea of contenido.split('\n')) {
      const t = linea.trim();
      if (!t.startsWith('COPY ') || t.includes('--from=')) continue;

      // COPY <origen...> <destino>: el último token es el destino.
      const partes = t.slice(5).trim().split(/\s+/);
      for (const origen of partes.slice(0, -1)) {
        // Los que terminan en * son opcionales por convención (package-lock.json*)
        if (origen.endsWith('*')) continue;
        const glob = origen.replace(/\/$/, '');
        if (glob.includes('*')) {
          const dir = join(contexto, glob.slice(0, glob.lastIndexOf('/')));
          const patron = glob.slice(glob.lastIndexOf('/') + 1).replace('*', '');
          let hay = false;
          try {
            hay = readdirSync(dir).some((f) => f.endsWith(patron));
          } catch { hay = false; }
          if (!hay) sinCoincidencias.push(origen);
        } else if (!existsSync(join(contexto, glob))) {
          sinCoincidencias.push(origen);
        }
      }
    }
    expect({ sinCoincidencias }).toEqual({ sinCoincidencias: [] });
  });
});
