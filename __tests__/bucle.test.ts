/**
 * Corte de conversaciones que se repiten sin avanzar (bot-wa).
 *
 * Pasó en producción: otro sistema automatizado reenviaba su mensaje enlatado
 * cada 38 segundos exactos, el bot contestaba «no entendí», y así
 * indefinidamente. Cada vuelta gastaba una llamada a Claude y cuota del límite
 * por cliente.
 *
 * Lo que más importa probar no es que corte, sino **a quién NO corta**. Dejar
 * en silencio a un cliente real es peor que el bucle: el bucle sale caro, un
 * cliente ignorado se va a otro lavadero.
 */
import {
  DetectorDeBucle,
  UMBRAL_BUCLE,
  OLVIDO_MS,
} from '../bot-wa/src/bucle';

const A = '573001112222@s.whatsapp.net';
const B = '573003334444@s.whatsapp.net';

describe('el bucle se corta', () => {
  it('responde hasta el umbral, avisa una vez, y luego calla', () => {
    const d = new DetectorDeBucle();
    const mismo = 'Tu solicitud ya tiene abierto el preliminar #D21428';

    // Las primeras van normales.
    for (let i = 1; i < UMBRAL_BUCLE; i++) {
      expect(d.decidir(A, mismo)).toBe('responder');
    }
    // En el umbral, una última respuesta que explica por qué se calla.
    expect(d.decidir(A, mismo)).toBe('ultimo-aviso');
    // A partir de ahí, nada: ni respuesta ni llamada a la IA.
    expect(d.decidir(A, mismo)).toBe('silencio');
    expect(d.decidir(A, mismo)).toBe('silencio');
  });

  it('reproduce el caso real: cuatro mensajes idénticos seguidos', () => {
    const d = new DetectorDeBucle();
    const enlatado = 'Tu solicitud ya tiene abierto el preliminar #D21428. Mi comp';
    const t0 = 1_788_000_000_000;

    const decisiones = [0, 38_000, 76_000, 114_000].map((dt) =>
      d.decidir(A, enlatado, t0 + dt),
    );

    expect(decisiones).toEqual(['responder', 'responder', 'ultimo-aviso', 'silencio']);
  });

  it('el texto se compara sin distinguir mayúsculas ni espacios de sobra', () => {
    const d = new DetectorDeBucle();
    expect(d.decidir(A, 'Hola')).toBe('responder');
    expect(d.decidir(A, '  hola ')).toBe('responder');
    expect(d.decidir(A, 'HOLA')).toBe('ultimo-aviso');
  });
});

describe('a quién NO se corta', () => {
  it('un texto distinto reinicia la cuenta al instante', () => {
    // Lo que hace esto seguro para una persona: basta con que diga otra cosa.
    const d = new DetectorDeBucle();
    d.decidir(A, 'hola');
    d.decidir(A, 'hola');
    expect(d.decidir(A, 'hola')).toBe('ultimo-aviso');

    expect(d.decidir(A, 'quiero agendar')).toBe('responder');
    expect(d.decidir(A, 'ABC123')).toBe('responder');
  });

  it('quien salió del silencio vuelve a ser atendido', () => {
    const d = new DetectorDeBucle();
    for (let i = 0; i < 6; i++) d.decidir(A, 'lo mismo');
    expect(d.decidir(A, 'lo mismo')).toBe('silencio');

    // Cambia de tema: se le atiende, y sin arrastrar la cuenta anterior.
    expect(d.decidir(A, 'hola')).toBe('responder');
    expect(d.decidir(A, 'hola')).toBe('responder');
  });

  it('silenciar a uno no afecta a los demás', () => {
    const d = new DetectorDeBucle();
    for (let i = 0; i < 5; i++) d.decidir(A, 'enlatado');
    expect(d.decidir(A, 'enlatado')).toBe('silencio');

    // B nunca escribió: no puede quedar afectado por el bucle de A.
    expect(d.decidir(B, 'enlatado')).toBe('responder');
  });

  it('pasado el tiempo de olvido se empieza de cero', () => {
    // Alguien que vuelve mañana no arrastra el silencio de hoy.
    //
    // La ventana se cuenta desde el ÚLTIMO mensaje, no desde el primero: es
    // "media hora sin escribir", no "media hora desde que empezó". Si se
    // contara desde el primero, un bucle lento se reiniciaría solo cada rato
    // y volvería a gastar llamadas indefinidamente.
    const d = new DetectorDeBucle();
    const t0 = 1_788_000_000_000;
    for (let i = 0; i < 5; i++) d.decidir(A, 'hola', t0 + i * 1_000);

    const ultimoMensaje = t0 + 6_000;
    expect(d.decidir(A, 'hola', ultimoMensaje)).toBe('silencio');

    // Justo antes de cumplirse el plazo sigue callado…
    expect(d.decidir(A, 'hola', ultimoMensaje + OLVIDO_MS - 1)).toBe('silencio');
    // …y al cumplirse, vuelve a atender.
    expect(d.decidir(A, 'hola', ultimoMensaje + OLVIDO_MS * 2)).toBe('responder');
  });

  it('un mensaje vacío no cuenta como texto propio', () => {
    // Los mensajes sin texto ya se descartan antes; esto sólo comprueba que
    // no revienta si llegara alguno.
    const d = new DetectorDeBucle();
    expect(d.decidir(A, '')).toBe('responder');
    expect(d.decidir(A, undefined as unknown as string)).toBe('responder');
  });
});

describe('no crece sin límite', () => {
  it('poda los remitentes más antiguos', () => {
    const d = new DetectorDeBucle(3, 60_000, 10);
    for (let i = 0; i < 100; i++) d.decidir(`${i}@s.whatsapp.net`, 'hola');
    expect(d.tamano).toBeLessThanOrEqual(10);
  });
});
