/**
 * Derechos del titular sobre sus datos (Ley 1581 de 2012): acceso, rectificación
 * y supresión.
 *
 * La ley obliga a que el titular pueda **consultar y hacer suprimir** sus datos
 * personales. Hasta ahora existía `anonimizarCliente()` pero no había forma de
 * que el cliente la ejerciera: el aviso lo derivaba a un asesor, que es válido
 * pero manual y depende de que alguien responda.
 *
 * ## Por qué palabras reservadas y no una intención de la IA
 *
 * Estas frases se interceptan **antes** que cualquier otra cosa, y se comparan
 * literalmente. No pasan por el clasificador.
 *
 * Eso tiene una consecuencia en el paso de corrección del nombre: quien escriba
 * ahí una palabra reservada está pidiendo otra cosa, y el despacho la atiende
 * antes de llegar al paso. `nombreValido` las rechaza igual, como segunda línea.
 *
 * Es deliberado y va en la línea del [ADR-0006](../../../docs/adr/0006-ia-solo-para-clasificar.md):
 * un derecho que la ley obliga a atender no puede depender de que un modelo
 * acierte la intención. Si Claude está caído, sin crédito, o simplemente
 * clasifica mal, el titular tiene que poder ejercerlo igual. El mismo criterio
 * por el que `0` cancela el agendamiento sin consultar a nadie.
 *
 * ## Quién puede pedirlo
 *
 * Quien escribe desde ese WhatsApp. El LID —o el teléfono— **es** la
 * credencial: es la cuenta del titular, y en este canal no hay prueba de
 * identidad más fuerte disponible. Por eso el borrado sólo alcanza al cliente
 * asociado a esa identidad y a ese lavadero, nunca a otro.
 */

/** Lo que el titular escribe para ver qué se guarda de él. */
const FRASES_ACCESO = [
  'mis datos',
  'ver mis datos',
  'que datos tienen',
  'qué datos tienen',
  'consultar mis datos',
];

/** Lo que escribe para corregir un dato equivocado. */
const FRASES_RECTIFICACION = [
  'corregir mis datos',
  'corregir mi nombre',
  'cambiar mi nombre',
  'mi nombre esta mal',
  'mi nombre está mal',
  'actualizar mis datos',
];

/** Lo que escribe para pedir la supresión. */
const FRASES_SUPRESION = [
  'borrar mis datos',
  'eliminar mis datos',
  'borren mis datos',
  'eliminen mis datos',
  'quiero que borren mis datos',
  'dar de baja mis datos',
];

/** La confirmación, que se pide aparte porque el borrado no se deshace. */
const FRASES_CONFIRMACION = ['confirmo', 'confirmar', 'si confirmo', 'sí confirmo'];

export type AccionDatos = 'acceso' | 'rectificacion' | 'supresion' | 'confirmacion' | null;

/** Normaliza para comparar: sin tildes, sin mayúsculas, sin puntuación. */
function normalizar(texto: string): string {
  return String(texto ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // marcas diacriticas: a con tilde -> a
    .replace(/[.,!\u00a1?\u00bf]/g, '') // "confirmo." tiene que valer igual
    .replace(/\s+/g, ' ');
}

/**
 * Qué está pidiendo el titular, o `null` si no es una petición de datos.
 *
 * La coincidencia es **exacta contra la frase completa**, no por palabras
 * sueltas dentro de un texto libre. Un cliente que escribe «no quiero que
 * borren mis datos» no está pidiendo el borrado, y confundirlo sería
 * destruir información por una coincidencia de subcadena.
 */
export function accionSolicitada(texto: string): AccionDatos {
  const t = normalizar(texto);
  if (!t) return null;
  if (FRASES_SUPRESION.map(normalizar).includes(t)) return 'supresion';
  if (FRASES_RECTIFICACION.map(normalizar).includes(t)) return 'rectificacion';
  if (FRASES_ACCESO.map(normalizar).includes(t)) return 'acceso';
  if (FRASES_CONFIRMACION.map(normalizar).includes(t)) return 'confirmacion';
  return null;
}

/** Lo que se sabe del titular, para mostrárselo. */
export interface ResumenDatos {
  nombre: string;
  telefono: string | null;
  visitas: number;
  vehiculos: string[];
  turnosFuturos: number;
  consentAt: Date | null;
}

/** El texto del derecho de acceso: qué hay guardado y qué se puede hacer. */
export function textoAcceso(r: ResumenDatos): string {
  const lineas = [
    '🗂️ *Esto es lo que tenemos tuyo*',
    '',
    `• Nombre: ${r.nombre}`,
    `• Contacto: ${r.telefono ?? 'tu WhatsApp'}`,
    `• Visitas registradas: ${r.visitas}`,
  ];

  if (r.vehiculos.length > 0) {
    lineas.push(`• Vehículos: ${r.vehiculos.join(', ')}`);
  }
  if (r.consentAt) {
    const f = r.consentAt.toISOString().split('T')[0];
    lineas.push(`• Autorizaste el tratamiento el ${f}`);
  }

  lineas.push(
    '',
    'También guardamos el historial de tus turnos y esta conversación.',
    '',
    'Para corregir tu nombre, escribe *CORREGIR MIS DATOS*.',
    'Para cualquier otra corrección, escribe *ASESOR*.',
    'Para eliminarlo todo, escribe *BORRAR MIS DATOS*.',
  );

  return lineas.join('\n');
}

/**
 * Lo que se pregunta antes de borrar.
 *
 * Se avisa de lo que se pierde y de lo que no. Un turno agendado sigue en pie
 * —el lavadero se comprometió a prestarlo— pero deja de haber a quién avisarle,
 * y eso el titular tiene que saberlo antes de decidir, no después.
 */
export function textoConfirmarSupresion(r: ResumenDatos): string {
  const lineas = [
    '⚠️ *Esto no se puede deshacer*',
    '',
    'Si continúas, borramos tu nombre, tu contacto y los datos de tus ' +
      'vehículos. No podremos reconocerte si vuelves a escribir.',
  ];

  if (r.turnosFuturos > 0) {
    lineas.push(
      '',
      `⚠️ Tienes ${r.turnosFuturos === 1 ? 'un turno agendado' : `${r.turnosFuturos} turnos agendados`}. ` +
        'El turno sigue en pie, pero **dejaremos de poder avisarte**: no te ' +
        'llegará el recordatorio ni el aviso de que tu vehículo está listo.',
    );
  }

  lineas.push(
    '',
    'El historial de servicios del lavadero se conserva sin tu nombre, ' +
      'porque es información del negocio y ya no te identifica.',
    '',
    'Escribe *CONFIRMO* para borrarlos, o *0* para dejarlo así.',
  );

  return lineas.join('\n');
}

export const TEXTO_SUPRESION_HECHA =
  '✅ Listo, borramos tus datos personales.\n\n' +
  'Si algún día vuelves a escribirnos, empezaremos de cero. Gracias por ' +
  'habernos acompañado. 👋';

export const TEXTO_SIN_DATOS =
  'No tenemos datos tuyos guardados. 🙂\n\n' +
  'Si escribiste antes desde otro número, pide *ASESOR* y lo revisamos.';

export const TEXTO_CONFIRMACION_SIN_CONTEXTO =
  'No tengo ninguna solicitud pendiente de confirmar.\n\n' +
  'Si quieres ver o borrar tus datos, escribe *MIS DATOS*.';

/** Paso de la sesión mientras se espera la confirmación del borrado. */
export const FLUJO_DATOS = 'datos';
export const PASO_CONFIRMAR_SUPRESION = 'awaiting_delete_confirm';
/** Paso mientras se espera el nombre corregido. */
export const PASO_CORREGIR_NOMBRE = 'awaiting_name_fix';

// ─── Rectificación ────────────────────────────────────────────────────────────

/**
 * Por qué sólo el nombre se corrige solo.
 *
 * Es el único dato personal que el bot capturó **del propio titular** y que
 * puede estar mal sin consecuencias para nadie más. El resto se deriva a un
 * asesor, y no por pereza:
 *
 * - **El teléfono y el LID son la credencial.** En este canal la identidad *es*
 *   la cuenta de WhatsApp desde la que se escribe. Dejar cambiarlos sería dejar
 *   que alguien reclame los datos de otro.
 * - **El tipo de vehículo fija el precio.** `getServicePrice` cobra según él;
 *   poder cambiarlo a `moto` es poder pagar menos.
 * - **La placa es como el lavadero encuentra el carro**, y podría chocar con la
 *   de otro cliente del mismo lavadero.
 *
 * Derivar esos casos a un asesor es un canal atendido, que es lo que la ley
 * pide. Lo que no era aceptable era que **todo** dependiera de que alguien
 * conteste.
 */
export function textoPedirNombre(actual: string): string {
  return [
    '✏️ *Corregir tu nombre*',
    '',
    `Ahora mismo te tenemos como *${actual}*.`,
    '',
    'Escribe cómo quieres que aparezca, o *0* para dejarlo así.',
  ].join('\n');
}

export function textoNombreCorregido(nuevo: string): string {
  return (
    `✅ Listo, ahora te tenemos como *${nuevo}*.\n\n` +
    'Si hay algo más que corregir —tu placa, tu teléfono— escribe *ASESOR* y lo ' +
    'revisamos contigo.'
  );
}

export const TEXTO_NOMBRE_INVALIDO =
  'Ese nombre no me sirve. 😅\n\n' +
  'Escribe sólo tu nombre, sin números ni símbolos, o *0* para dejarlo como está.';

/**
 * ¿Sirve como nombre?
 *
 * Rechaza lo que claramente no lo es. Vale la pena ser estricto acá: lo que se
 * escriba queda como el nombre del titular, y un «BORRAR MIS DATOS» tecleado en
 * este paso se guardaría como nombre en vez de entenderse.
 */
export function nombreValido(texto: string): boolean {
  const t = String(texto ?? '').trim();
  if (t.length < 2 || t.length > 80) return false;
  // Una palabra reservada escrita acá es una petición mal entendida, no un
  // nombre: se rechaza para poder repreguntar.
  if (accionSolicitada(t) !== null) return false;
  // Sin dígitos: una placa o un teléfono tecleados por error no son un nombre.
  if (/\d/.test(t)) return false;
  return /^[\p{L}\s'.\-]+$/u.test(t);
}

/** Parte el nombre en las dos columnas, como hace el alta. */
export function partirNombre(texto: string): { first: string; last: string | null } {
  const partes = texto.trim().split(/\s+/);
  return {
    first: partes[0].slice(0, 80),
    last: partes.slice(1).join(' ').slice(0, 80) || null,
  };
}
