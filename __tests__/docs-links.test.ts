/**
 * Los enlaces entre documentos tienen que apuntar a archivos que existan.
 *
 * El README prometía un `docs/OPS.md` con el runbook de operación. Ese archivo
 * nunca existió con ese contenido: el que llevaba el nombre resultó ser una
 * guía del frontend y se renombró, pero el enlace se quedó. Un enlace roto en
 * un README es peor que no tenerlo — promete documentación que no está, y
 * quien la busca asume que el problema es suyo.
 *
 * Chequeo estático: no lee red, sólo el sistema de archivos.
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, relative } from 'path';

const RAIZ = join(__dirname, '..');

/** Los markdown del proyecto, sin node_modules. */
function documentos(): string[] {
  const encontrados: string[] = [];

  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (entrada.name.endsWith('.md')) encontrados.push(ruta);
    }
  };

  recorrer(RAIZ);
  return encontrados;
}

/**
 * Destinos locales de los enlaces markdown de un archivo.
 *
 * Se ignoran los absolutos (http, mailto) y los anclas puras (#seccion):
 * comprobar que una sección exista es otro problema, y uno con más falsos
 * positivos que valor.
 */
function enlacesLocales(contenido: string): string[] {
  const destinos: string[] = [];
  for (const m of contenido.matchAll(/\]\(([^)\s]+)\)/g)) {
    const destino = m[1];
    if (/^(https?:|mailto:|#)/.test(destino)) continue;
    destinos.push(destino.split('#')[0]);
  }
  return destinos.filter(Boolean);
}

describe('documentación: enlaces internos', () => {
  const archivos = documentos();

  it('encuentra los markdown del proyecto', () => {
    // Si esto queda vacío el test no está probando nada.
    expect(archivos.length).toBeGreaterThan(5);
  });

  it('ningún enlace apunta a un archivo que no existe', () => {
    const rotos: string[] = [];

    for (const archivo of archivos) {
      const contenido = readFileSync(archivo, 'utf8');
      for (const destino of enlacesLocales(contenido)) {
        if (!existsSync(join(dirname(archivo), destino))) {
          rotos.push(`${relative(RAIZ, archivo)} → ${destino}`);
        }
      }
    }

    expect({ rotos }).toEqual({ rotos: [] });
  });
});
