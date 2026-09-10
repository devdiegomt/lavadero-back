/**
 * Autorización de tratamiento de datos personales (Ley 1581 de 2012).
 *
 * La ley exige autorización **previa, expresa e informada** del titular. Eso
 * son tres cosas distintas y las tres tienen que cumplirse:
 *
 * - *previa*: antes de guardar el dato, no después
 * - *expresa*: una respuesta afirmativa, no el silencio ni seguir conversando
 * - *informada*: diciéndole qué se guarda, para qué, y cuáles son sus derechos
 *
 * Por eso el texto vive acá versionado: si mañana cambia la finalidad, cambia
 * la versión, y queda registro de qué se le informó a cada titular.
 *
 * ⚠️ El texto es una base técnica, no asesoría legal. Corresponde al
 * responsable del tratamiento validarlo y publicar su política completa.
 */

/**
 * Versión del aviso. Se guarda en `customers.consent_version`.
 *
 * Al cambiar el texto de forma sustantiva —otra finalidad, otro destinatario—
 * hay que subir la versión. Un cambio de redacción que no altere el alcance
 * puede conservarla.
 */
export const VERSION_AVISO = '2026-09-v1';

/** Lo que se le pregunta al titular antes de guardar sus datos. */
export function textoAutorizacion(nombreLavadero: string): string {
  return (
    `🔒 *Antes de continuar*\n\n` +
    `Para agendarte, ${nombreLavadero} necesita guardar tu nombre, tu contacto ` +
    `de WhatsApp y los datos de tu vehículo.\n\n` +
    `Se usan únicamente para gestionar tus turnos y tu historial de servicios. ` +
    `No se comparten con terceros con fines comerciales.\n\n` +
    // MIS DATOS y BORRAR MIS DATOS son palabras reservadas que el bot atiende
    // el mismo, sin pasar por la IA: ver datos-personales.ts. Se prometieron
    // una vez sin que existieran y hubo que quitarlas del aviso; ahora existen.
    // Corregir sigue siendo humano, de ahi que ASESOR se mantenga.
    `Escribe *MIS DATOS* cuando quieras para ver qué guardamos, o ` +
    `*BORRAR MIS DATOS* para eliminarlos. Para corregir algo, *ASESOR*.\n\n` +
    `¿Autorizas el tratamiento de tus datos? Responde *SI* para continuar.`
  );
}

/** Lo que se responde si el titular no autoriza. */
export const TEXTO_RECHAZO =
  'Entendido, no guardaremos tus datos. 👍\n\n' +
  'Sin esa autorización no podemos agendarte, pero sigues pudiendo ' +
  'consultarnos precios y servicios cuando quieras.';

/** Aclaración cuando la respuesta no es un sí ni un no claro. */
export const TEXTO_REPREGUNTA =
  'Necesito una respuesta clara para continuar.\n\n' +
  'Responde *SI* para autorizar, o *NO* si prefieres que no guardemos tus datos.';

const AFIRMATIVAS = ['si', 'sí', 's', 'yes', 'acepto', 'autorizo', 'dale', 'ok'];
// 'cancelar' está acá por completitud, pero en el flujo de WhatsApp no llega:
// wa-bridge.booking.ts lo intercepta antes junto con 0, menu y salir. Importa
// si esta función se reusa desde el panel o el onboarding.
const NEGATIVAS = ['no', 'n', 'nel', 'nop', 'cancelar'];

export type RespuestaConsentimiento = 'acepta' | 'rechaza' | 'ambiguo';

/**
 * Interpreta la respuesta del titular.
 *
 * Sólo un sí explícito cuenta como autorización: la ley pide que sea expresa,
 * así que cualquier otra cosa —incluido seguir conversando— es ambigua y se
 * vuelve a preguntar.
 */
export function interpretarRespuesta(texto: string): RespuestaConsentimiento {
  const t = String(texto || '').trim().toLowerCase().replace(/[.!¡]/g, '');
  if (AFIRMATIVAS.includes(t)) return 'acepta';
  if (NEGATIVAS.includes(t)) return 'rechaza';
  return 'ambiguo';
}

/** Datos de la autorización, para guardar junto al cliente. */
export interface Autorizacion {
  consentAt: Date;
  consentVersion: string;
  consentSource: 'whatsapp' | 'panel' | 'onboarding';
}

export function autorizacionDe(source: Autorizacion['consentSource']): Autorizacion {
  return {
    consentAt: new Date(),
    consentVersion: VERSION_AVISO,
    consentSource: source,
  };
}
