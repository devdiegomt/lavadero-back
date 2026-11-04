/**
 * Quién es el responsable del tratamiento en la política de Qlarity.
 *
 * Qlarity lo opera una persona natural; la Ley 1581 exige que la política diga
 * su nombre, identificación y cómo contactarla. **Completar antes de
 * publicar.** Mientras un campo esté vacío, la página lo muestra resaltado en
 * rojo como «por completar», a propósito: que se note, en vez de publicar una
 * política sin responsable.
 *
 * El correo es el canal para consultas y reclamos sobre datos personales: tiene
 * que ser uno que alguien lea, porque la ley pone plazos para responder.
 */
export const RESPONSABLE = {
  nombre: '',          // Nombre completo
  documento: '',       // p. ej. «C.C. 1.234.567.890»
  ciudad: '',          // Ciudad de domicilio
  direccion: '',       // Dirección de notificaciones
  correo: '',          // Correo para datos personales
  telefono: '',        // Opcional
};

/** Versión de la política. Sube junto con VERSION_POLITICA_QLARITY del backend. */
export const VERSION_POLITICA = '2026-11-v1';
export const VIGENTE_DESDE = '2026-11-04';

/**
 * Versión del aviso de cada lavadero. Sube junto con VERSION_AVISO_LAVADERO
 * del backend: es la que queda guardada en cada autorización del panel.
 */
export const VERSION_AVISO_LAVADERO = '2026-11-v1';
