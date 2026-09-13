/**
 * Corta las conversaciones que se repiten sin avanzar.
 *
 * Pasó en producción: otro sistema automatizado tenía conversación abierta con
 * el número del lavadero y reenviaba su mensaje enlatado **cada 38 segundos
 * exactos**. El bot contestaba «no entendí», el otro respondía lo mismo otra
 * vez, y así indefinidamente. Dos bots hablándose.
 *
 * No es sólo ruido: cada vuelta gasta una llamada a Claude y cuota del límite
 * por cliente, y puede durar días sin que nadie lo note.
 *
 * ## Qué se considera un bucle
 *
 * **El mismo remitente enviando exactamente el mismo texto, varias veces
 * seguidas.** Nada más. No se mira el contenido de la respuesta ni se intenta
 * adivinar si el otro es un bot: eso acabaría en heurísticas frágiles.
 *
 * Un texto distinto **reinicia la cuenta al instante**. Es lo que hace que esto
 * sea seguro para una persona: quien escriba «hola» tres veces y luego cualquier
 * otra cosa vuelve a ser atendido de inmediato. El único que se queda en
 * silencio es quien repite lo mismo, que es justo lo que hace un autorespondedor.
 */

/** Repeticiones idénticas seguidas antes de dejar de responder. */
export const UMBRAL_BUCLE = 3;

/**
 * Cuánto se recuerda a un remitente sin escribir. Pasado ese tiempo se olvida,
 * para que alguien que vuelva mañana no arrastre el silencio de hoy.
 */
export const OLVIDO_MS = 30 * 60 * 1_000;

/** Tope de remitentes recordados, para que el mapa no crezca sin límite. */
export const MAX_REMITENTES = 1_000;

export type Decision =
  /** Conversación normal. */
  | 'responder'
  /** Se alcanzó el umbral: una última respuesta explicando, y a callar. */
  | 'ultimo-aviso'
  /** Ya se avisó. No se responde ni se consulta a la IA. */
  | 'silencio';

/** Lo que se le dice al otro extremo antes de dejar de responder. */
export const TEXTO_ULTIMO_AVISO =
  'Parece que nos quedamos repitiendo lo mismo. 😅\n\n' +
  'Voy a dejar de responder para no llenarte el chat. Escríbeme algo ' +
  'distinto cuando quieras y seguimos, o pide *ASESOR* para hablar con una ' +
  'persona.';

interface Rastro {
  texto: string;
  repeticiones: number;
  ultimoMs: number;
}

export class DetectorDeBucle {
  private readonly rastros = new Map<string, Rastro>();

  constructor(
    private readonly umbral: number = UMBRAL_BUCLE,
    private readonly olvidoMs: number = OLVIDO_MS,
    private readonly maximo: number = MAX_REMITENTES,
  ) {}

  /**
   * Qué hacer con este mensaje. Registra el intento, así que se llama **una
   * vez por mensaje entrante**.
   */
  decidir(remitente: string, texto: string, ahora: number = Date.now()): Decision {
    const clave = String(texto ?? '').trim().toLowerCase();
    const previo = this.rastros.get(remitente);

    const vencido = previo !== undefined && ahora - previo.ultimoMs >= this.olvidoMs;
    const esOtroTexto = previo === undefined || previo.texto !== clave;

    if (vencido || esOtroTexto) {
      this.rastros.set(remitente, { texto: clave, repeticiones: 1, ultimoMs: ahora });
      this.podar(ahora);
      return 'responder';
    }

    previo.repeticiones += 1;
    previo.ultimoMs = ahora;

    if (previo.repeticiones < this.umbral) return 'responder';
    if (previo.repeticiones === this.umbral) return 'ultimo-aviso';
    return 'silencio';
  }

  /** Cuántos remitentes se están recordando. Para pruebas y diagnóstico. */
  get tamano(): number {
    return this.rastros.size;
  }

  private podar(ahora: number): void {
    for (const [jid, r] of this.rastros) {
      if (ahora - r.ultimoMs >= this.olvidoMs) this.rastros.delete(jid);
    }
    for (const jid of this.rastros.keys()) {
      if (this.rastros.size <= this.maximo) break;
      this.rastros.delete(jid);
    }
  }
}
