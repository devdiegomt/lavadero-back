/**
 * Una variable de entorno vacía tiene que contar como no definida.
 *
 * docker-compose escribe `VAR: ${VAR:-}` como string vacío, no como ausente.
 * Con SENTRY_DSN='' el backend moría al arrancar con "Invalid url" por una
 * variable que es opcional — y el síntoma visible era el contenedor caído,
 * no el nombre de la variable.
 */
import { z } from 'zod';

/** Misma normalización que aplica config.ts antes de validar. */
const sinVacios = (env: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));

describe('config: variables vacías', () => {
  const esquema = z.object({
    SENTRY_DSN: z.string().url().optional(),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
  });

  it("'' se descarta y la opcional queda undefined", () => {
    const r = esquema.safeParse(sinVacios({ SENTRY_DSN: '' }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.SENTRY_DSN).toBeUndefined();
  });

  it("'' deja que aplique el default en vez de pisarlo", () => {
    const r = esquema.safeParse(sinVacios({ CORS_ORIGIN: '' }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.CORS_ORIGIN).toBe('http://localhost:5173');
  });

  it('un valor inválido de verdad sigue fallando', () => {
    const r = esquema.safeParse(sinVacios({ SENTRY_DSN: 'no-es-url' }));
    expect(r.success).toBe(false);
  });

  it('un valor válido se conserva', () => {
    const dsn = 'https://abc@sentry.io/123';
    const r = esquema.safeParse(sinVacios({ SENTRY_DSN: dsn }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.SENTRY_DSN).toBe(dsn);
  });

  it('config.ts aplica la normalización', () => {
    // Guard: si alguien saca el filtro, esto lo señala.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/config.ts'), 'utf8',
    );
    expect(src).toMatch(/filter\(\(\[,\s*v\]\)\s*=>\s*v\s*!==\s*''\)/);
  });
});
