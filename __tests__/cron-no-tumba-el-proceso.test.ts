/**
 * Que una tarea de fondo que falla no se lleve puesta la API.
 *
 * Esto existe porque pasó. La base de datos de producción dejó de resolver por
 * DNS y el proceso **murió**, no devolvió errores: los cuatro intervalos de
 * `initCronJobs` eran `void conBypassRlsFueraDePeticion(...)` sin `catch`, y en
 * Node 20 una promesa rechazada que nadie maneja termina el proceso.
 *
 *     Error: getaddrinfo ENOTFOUND dpg-…
 *         at async conBypassRlsFueraDePeticion (…/rls.js:146:21)
 *     Node.js v20.20.2
 *
 * Render reiniciaba, el recordatorio volvía a tocar a los 5 minutos, y otra vez.
 * Una API caída en ciclo por una dependencia que sólo hacía falta para borrar
 * filas viejas.
 *
 * El `try/catch` que las tareas ya tenían adentro no servía: lo que falla es
 * `pool.connect()` en el envoltorio, antes de que la tarea llegue a correr. Por
 * eso lo que se prueba acá es el envoltorio, no las tareas.
 */
import { correrTarea } from '../src/shared/db/cron';
import logger from '../src/shared/utils/logger';

describe('correrTarea', () => {
  it('no propaga el error de una tarea que falla', async () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined as never);

    // La forma exacta del fallo de producción: el DNS de la base no resuelve.
    const comoEnProduccion = Object.assign(
      new Error('getaddrinfo ENOTFOUND dpg-d9c1b3mq1p3s73b75040-a'),
      { code: 'ENOTFOUND', syscall: 'getaddrinfo' },
    );

    await expect(
      correrTarea('tarea-de-prueba', () => Promise.reject(comoEnProduccion)),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ err: comoEnProduccion, tarea: 'tarea-de-prueba' }),
      'Tarea programada falló',
    );

    error.mockRestore();
  });

  it('una tarea que falla no deja una promesa rechazada suelta', async () => {
    // Lo que de verdad mataba el proceso. `void` sobre una promesa que rechaza
    // dispara `unhandledRejection`, y ese es el evento que Node usa para
    // terminar. Si `correrTarea` dejara escapar el error, este oyente lo vería.
    const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    const sueltas: unknown[] = [];
    const oyente = (razon: unknown): void => {
      sueltas.push(razon);
    };
    process.on('unhandledRejection', oyente);

    try {
      void correrTarea('tarea-de-prueba', () => Promise.reject(new Error('la base no responde')));
      // Dos vueltas de microtareas y una de macrotareas: `unhandledRejection` se
      // emite al final del turno, no en el `await` siguiente.
      await new Promise((listo) => setImmediate(listo));
      await new Promise((listo) => setImmediate(listo));

      expect(sueltas).toEqual([]);
    } finally {
      process.off('unhandledRejection', oyente);
      error.mockRestore();
    }
  });

  it('devuelve normalmente cuando la tarea anda', async () => {
    const tarea = jest.fn().mockResolvedValue(7);
    await expect(correrTarea('ok', tarea)).resolves.toBeUndefined();
    expect(tarea).toHaveBeenCalledTimes(1);
  });
});
