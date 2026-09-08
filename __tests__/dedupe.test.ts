/**
 * Descarte de mensajes reenviados por WhatsApp (bot-wa).
 *
 * El caso que motiva esto se vio en producción: WhatsApp reenvió «Agendar un
 * turno» 160 ms después del original, y como cada mensaje del flujo de
 * agendamiento avanza un paso, el reenvío se consumió como si fuera la placa.
 * La conversación quedó atascada respondiendo «placa no válida» a todo.
 *
 * Lo que se prueba es que descarta el reenvío **sin** descartar mensajes
 * legítimos repetidos: un cliente que escribe «Hola» dos veces son dos
 * mensajes distintos, con ids distintos, y los dos tienen que pasar.
 */
import { Deduplicador } from '../bot-wa/src/dedupe';

describe('descarte de reenvíos', () => {
  it('el mismo id sólo pasa una vez', () => {
    const d = new Deduplicador();

    expect(d.yaVisto('ABC123')).toBe(false);
    expect(d.yaVisto('ABC123')).toBe(true);
    expect(d.yaVisto('ABC123')).toBe(true);
  });

  it('reproduce el caso real: el reenvío a 160 ms no avanza el flujo', () => {
    const d = new Deduplicador();
    const t0 = 1_788_833_510_598;

    expect(d.yaVisto('3AF2961A4AA388D84FFA', t0)).toBe(false);
    expect(d.yaVisto('3AF2961A4AA388D84FFA', t0 + 160)).toBe(true);
  });

  it('dos mensajes distintos pasan aunque digan lo mismo', () => {
    // Escribir «Hola» dos veces son dos mensajes, no un reenvío. Descartar el
    // segundo dejaría al cliente sin respuesta.
    const d = new Deduplicador();

    expect(d.yaVisto('id-uno')).toBe(false);
    expect(d.yaVisto('id-dos')).toBe(false);
  });

  it('pasada la ventana el id vuelve a aceptarse', () => {
    const d = new Deduplicador(1_000);
    const t0 = 1_000_000;

    expect(d.yaVisto('X', t0)).toBe(false);
    expect(d.yaVisto('X', t0 + 999)).toBe(true);
    expect(d.yaVisto('X', t0 + 1_001)).toBe(false);
  });

  it('sin id no descarta nada', () => {
    // Sin identificador no hay forma de distinguir un reenvío de un mensaje
    // legítimo. Procesar de más es preferible a comerse mensajes.
    const d = new Deduplicador();

    expect(d.yaVisto('')).toBe(false);
    expect(d.yaVisto('')).toBe(false);
  });

  it('no crece sin límite', () => {
    const d = new Deduplicador(60_000, 10);

    for (let i = 0; i < 100; i++) d.yaVisto(`id-${i}`);

    expect(d.tamano).toBeLessThanOrEqual(10);
    // Y lo que sobrevive es lo reciente: el último sigue reconociéndose.
    expect(d.yaVisto('id-99')).toBe(true);
  });

  it('lo vencido se olvida aunque no se llegue al tope', () => {
    const d = new Deduplicador(1_000, 1_000);
    const t0 = 5_000_000;

    d.yaVisto('viejo', t0);
    d.yaVisto('nuevo', t0 + 2_000);

    expect(d.tamano).toBe(1);
  });
});
