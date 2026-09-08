/**
 * Descarte de mensajes reenviados por WhatsApp.
 *
 * WhatsApp reenvía el mismo mensaje cuando el primer intento de descifrado
 * falla — los `Bad MAC` que aparecen después de re-vincular la sesión. El
 * reenvío llega con el **mismo `messageId`** pero como un evento nuevo.
 *
 * En una conversación de agendamiento eso no es inocuo. Cada mensaje avanza un
 * paso, así que procesar el reenvío no repite la respuesta: **consume el paso
 * siguiente con el texto anterior**. Pasó en producción — un «Agendar un
 * turno» duplicado a 160 ms, y el segundo se leyó como si fuera la placa,
 * dejando la conversación atascada en `awaiting_plate` hasta que el cliente
 * escribió `0`.
 *
 * No se persiste a propósito: un reenvío llega en segundos, y si el bot se
 * reinicia la sesión de WhatsApp se rompe igual.
 */

/** Cuánto tiempo se recuerda un id. Los reenvíos llegan en segundos. */
export const VENTANA_DEDUPE_MS = 5 * 60 * 1_000;

/** Tope de ids recordados, para que el mapa no crezca sin límite. */
export const MAX_RECORDADOS = 1_000;

export class Deduplicador {
  private readonly vistos = new Map<string, number>();

  constructor(
    private readonly ventanaMs: number = VENTANA_DEDUPE_MS,
    private readonly maximo: number = MAX_RECORDADOS,
  ) {}

  /**
   * `true` si este id ya se atendió dentro de la ventana. Si es nuevo, lo
   * registra: preguntar y marcar son la misma operación a propósito, porque
   * separarlas invita a olvidar la segunda.
   *
   * Un id vacío nunca se considera duplicado — sin identificador no hay forma
   * de distinguir un reenvío de un mensaje legítimo, y descartar de más es
   * peor que procesar de más.
   */
  yaVisto(messageId: string, ahora: number = Date.now()): boolean {
    if (!messageId) return false;

    const visto = this.vistos.get(messageId);
    if (visto !== undefined && ahora - visto < this.ventanaMs) return true;

    this.vistos.set(messageId, ahora);
    this.podar(ahora);
    return false;
  }

  /** Cuántos ids se están recordando. Para pruebas y diagnóstico. */
  get tamano(): number {
    return this.vistos.size;
  }

  /**
   * Descarta lo vencido y, si aun así sobra, lo más antiguo.
   *
   * El `Map` de JavaScript itera en orden de inserción, así que recorrerlo de
   * frente da los ids más viejos primero.
   */
  private podar(ahora: number): void {
    for (const [id, t] of this.vistos) {
      if (ahora - t >= this.ventanaMs) this.vistos.delete(id);
    }
    for (const id of this.vistos.keys()) {
      if (this.vistos.size <= this.maximo) break;
      this.vistos.delete(id);
    }
  }
}
