/**
 * Política de tratamiento de datos personales de Qlarity (Ley 1581 de 2012 y
 * Decreto 1377 de 2013, compilado en el Decreto 1074 de 2015).
 *
 * Describe lo que el sistema hace de verdad: cada dato, plazo y proveedor de
 * esta página sale del código o de la configuración de producción (ver
 * docs/05-seguridad.md §5). Si el sistema cambia lo que guarda o con quién lo
 * comparte, esta página cambia con él y sube la versión.
 *
 * Es una base técnica cuidadosa, no asesoría legal: conviene que la revise un
 * abogado antes de tomarla como definitiva.
 */
import { Link } from 'react-router-dom';
import PaginaLegal, { Dato, Seccion } from '../components/PaginaLegal';
import { RESPONSABLE, VERSION_POLITICA, VIGENTE_DESDE } from '../lib/responsable';

const ENCARGADOS: Array<{ quien: string; para: string; donde: string }> = [
  { quien: 'Supabase', para: 'Base de datos donde se guarda todo lo que registra el panel', donde: 'Estados Unidos' },
  { quien: 'Render', para: 'Servidor que atiende al panel y procesa los datos', donde: 'Estados Unidos' },
  { quien: 'Vercel', para: 'Publicación del panel web', donde: 'Estados Unidos y red global' },
  { quien: 'GitHub', para: 'Respaldos diarios de la base, cifrados', donde: 'Estados Unidos' },
  { quien: 'Anthropic', para: 'Entender los mensajes que llegan por WhatsApp (sólo si el lavadero usa el bot)', donde: 'Estados Unidos' },
  { quien: 'Meta (WhatsApp)', para: 'Enviar y recibir mensajes (sólo si el lavadero usa el bot)', donde: 'Estados Unidos y otros' },
  { quien: 'Alegra', para: 'Facturación electrónica (sólo si el lavadero la activa)', donde: 'Colombia' },
];

export default function PoliticaPrivacidadPage() {
  const r = RESPONSABLE;
  return (
    <PaginaLegal
      titulo="Política de tratamiento de datos personales"
      subtitulo={
        <>
          Cómo Qlarity recoge, usa, guarda y protege los datos personales, y cómo puedes ejercer tus derechos. Vigente
          desde el {new Date(VIGENTE_DESDE + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}.
        </>
      }
      version={VERSION_POLITICA}
    >
      <Seccion titulo="1. Quién es el responsable">
        <p>
          Qlarity es un software para administrar lavaderos de autos. Lo opera <Dato valor={r.nombre} falta="nombre completo" />,
          persona natural identificada con <Dato valor={r.documento} falta="documento" />, con domicilio en{' '}
          <Dato valor={r.ciudad} falta="ciudad" /> y dirección de notificaciones <Dato valor={r.direccion} falta="dirección" />.
        </p>
        <p>
          Para cualquier asunto sobre tus datos personales: <Dato valor={r.correo} falta="correo de contacto" />
          {r.telefono ? <> · {r.telefono}</> : null}.
        </p>
      </Seccion>

      <Seccion titulo="2. Dos papeles distintos: responsable y encargado">
        <p>
          <strong className="text-gray-900">Qlarity es responsable</strong> de los datos de las personas que usan el panel:
          el dueño que registra el lavadero y su equipo (administradores y operarios).
        </p>
        <p>
          <strong className="text-gray-900">Qlarity es encargado</strong> de los datos de los clientes de cada lavadero. El
          responsable de esos datos es el lavadero: es quien decide para qué los usa y a quien sus clientes le piden
          cuentas. Qlarity sólo los guarda y los procesa por cuenta del lavadero, para prestarle el servicio, y no los usa
          para nada propio. Cada lavadero tiene su propio aviso de privacidad, que el panel publica en una página con su
          nombre y sus datos de contacto.
        </p>
      </Seccion>

      <Seccion titulo="3. Qué datos se tratan">
        <p className="font-semibold text-gray-900">De quienes usan el panel</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Nombre, apellido, correo electrónico y teléfono.</li>
          <li>Contraseña, guardada sólo como un resumen cifrado que no permite recuperarla.</li>
          <li>Registro de acciones en el panel: quién cambió qué registro y cuándo, y la dirección IP desde donde se hizo. Se guardan los nombres de los campos que cambiaron, nunca sus valores.</li>
          <li>Del lavadero: nombre, NIT, razón social, dirección, ciudad, teléfono y correo del negocio.</li>
        </ul>
        <p className="font-semibold text-gray-900 pt-2">De los clientes de cada lavadero (como encargado)</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Nombre, teléfono, correo y, si el cliente lo da, su número de documento.</li>
          <li>Placa, tipo, marca, modelo, color y año de sus vehículos.</li>
          <li>Turnos, servicios, pagos e historial.</li>
          <li>Si el lavadero usa el bot de WhatsApp: el texto de los mensajes que el cliente escribe.</li>
          <li>Cuándo, cómo y bajo qué versión del aviso el cliente autorizó el tratamiento de sus datos.</li>
        </ul>
        <p>Qlarity no pide ni trata datos sensibles, ni está dirigido a menores de edad.</p>
      </Seccion>

      <Seccion titulo="4. Para qué se usan">
        <ul className="list-disc pl-5 space-y-1">
          <li>Prestar el servicio: que el lavadero agende, atienda, cobre y lleve el historial de sus clientes.</li>
          <li>Crear y administrar las cuentas de usuario, y permitir el inicio de sesión de forma segura.</li>
          <li>Enviar avisos sobre la cuenta: el fin de la prueba gratis, cambios de plan, incidentes que la afecten.</li>
          <li>Seguridad: detectar accesos indebidos y poder reconstruir quién hizo un cambio.</li>
          <li>Cobrar la suscripción y cumplir obligaciones contables y tributarias.</li>
        </ul>
        <p>Los datos no se venden ni se comparten con terceros con fines comerciales o publicitarios.</p>
      </Seccion>

      <Seccion titulo="5. Con quién se comparten, y en qué países están">
        <p>
          Qlarity funciona sobre servicios de terceros que actúan como encargados: guardan o procesan los datos sólo para
          que Qlarity funcione. Varios están fuera de Colombia, lo que es una transferencia internacional de datos.
        </p>
        <div className="overflow-x-auto border border-gray-100 rounded-lg bg-white">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-left border-b border-gray-100">
                <th className="px-3 py-2 font-semibold text-gray-900">Proveedor</th>
                <th className="px-3 py-2 font-semibold text-gray-900">Para qué</th>
                <th className="px-3 py-2 font-semibold text-gray-900">Dónde</th>
              </tr>
            </thead>
            <tbody>
              {ENCARGADOS.map((e) => (
                <tr key={e.quien} className="border-b border-gray-100 last:border-0 align-top">
                  <td className="px-3 py-2 text-gray-900 whitespace-nowrap">{e.quien}</td>
                  <td className="px-3 py-2">{e.para}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.donde}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Al aceptar esta política autorizas esas transferencias. Además de los proveedores, los datos sólo se entregan a
          una autoridad que los pida en ejercicio de sus funciones legales.
        </p>
      </Seccion>

      <Seccion titulo="6. Tus derechos">
        <p>Como titular de datos personales tienes derecho a:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Conocer, actualizar y rectificar tus datos.</li>
          <li>Pedir prueba de la autorización que diste.</li>
          <li>Saber para qué se han usado tus datos.</li>
          <li>Revocar la autorización y pedir que se supriman tus datos, cuando no exista un deber legal o contractual de conservarlos.</li>
          <li>Acceder gratis a tus datos.</li>
          <li>Presentar quejas ante la Superintendencia de Industria y Comercio, después de haber hecho tu consulta o reclamo aquí.</li>
        </ul>
      </Seccion>

      <Seccion titulo="7. Cómo ejercerlos">
        <p>
          <strong className="text-gray-900">Si eres cliente de un lavadero</strong>, el responsable de tus datos es el
          lavadero: escríbele por los datos de contacto de su aviso de privacidad. Si usa el bot de WhatsApp, también puedes
          escribir <em>MIS DATOS</em> para ver qué se guarda de ti, o <em>BORRAR MIS DATOS</em> para pedir que se supriman.
          Qlarity ayuda al lavadero a responderte.
        </p>
        <p>
          <strong className="text-gray-900">Si usas el panel</strong>, escribe a <Dato valor={r.correo} falta="correo de contacto" /> con tu
          nombre, tu documento, qué pides y cómo responderte.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong className="text-gray-900">Consultas</strong> (saber qué datos hay y cómo se usan): respuesta en máximo 10 días hábiles, prorrogables 5 más avisándote el motivo.</li>
          <li><strong className="text-gray-900">Reclamos</strong> (corregir, suprimir, revocar o reportar un incumplimiento): respuesta en máximo 15 días hábiles, prorrogables 8 más avisándote el motivo.</li>
        </ul>
      </Seccion>

      <Seccion titulo="8. Cuánto tiempo se guardan">
        <ul className="list-disc pl-5 space-y-1">
          <li>Las cuentas y los datos del lavadero, mientras use el servicio y lo que exijan las obligaciones legales después.</li>
          <li>Los mensajes de WhatsApp, 12 meses; después se borran.</li>
          <li>El registro de acciones del panel, 24 meses.</li>
          <li>Los respaldos de la base, 30 días.</li>
          <li>Las facturas electrónicas, el tiempo que exige la DIAN.</li>
        </ul>
        <p>Los clientes de un lavadero se conservan mientras el lavadero lo decida, o hasta que el cliente pida suprimirlos.</p>
      </Seccion>

      <Seccion titulo="9. Cómo se protegen">
        <ul className="list-disc pl-5 space-y-1">
          <li>Los datos de cada lavadero están aislados en la base de datos: un lavadero no puede ver los de otro.</li>
          <li>Las contraseñas se guardan cifradas y no se pueden recuperar, sólo cambiar.</li>
          <li>La sesión vive en una cookie protegida que el código de la página no puede leer.</li>
          <li>Las credenciales de facturación se guardan cifradas, y los respaldos también.</li>
          <li>Toda la comunicación viaja cifrada (HTTPS).</li>
        </ul>
      </Seccion>

      <Seccion titulo="10. Cookies">
        <p>
          El panel usa una sola cookie, técnica, para mantener tu sesión iniciada. No hay cookies de publicidad ni de
          analítica.
        </p>
      </Seccion>

      <Seccion titulo="11. Cambios a esta política">
        <p>
          Si cambia lo que se trata, para qué o con quién, se publica una versión nueva en esta página, con su fecha. Si el
          cambio es sustancial, se avisa a quienes usan el panel antes de aplicarlo.
        </p>
        <p className="text-sm text-gray-500 pt-4">
          <Link to="/login" className="text-brand-700 font-semibold hover:underline">Volver a Qlarity</Link>
        </p>
      </Seccion>
    </PaginaLegal>
  );
}
