/**
 * Aviso de privacidad de un lavadero: `/privacidad/:slug`.
 *
 * El responsable de los datos de los clientes de un lavadero es el lavadero
 * (Qlarity es su encargado). Este es el aviso que el operario le muestra al
 * cliente antes de marcar que autorizó, y el que se le puede mandar por enlace
 * o poner en un código QR en el mostrador. Cumple lo que el Decreto 1377 de 2013
 * (art. 15) pide del aviso: quién es el responsable y cómo contactarlo, qué se
 * trata y para qué, los derechos, y dónde está la política completa.
 *
 * El texto es el mismo para todos los lavaderos y tiene versión: cada
 * autorización del panel guarda VERSION_AVISO_LAVADERO, así que si el texto
 * cambia de forma sustancial, sube la versión aquí y en el backend.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PaginaLegal, { Dato, Seccion } from '../components/PaginaLegal';
import { api } from '../lib/api';
import { VERSION_AVISO_LAVADERO } from '../lib/responsable';

interface Lavadero {
  nombre: string;
  razonSocial: string | null;
  nit: string | null;
  direccion: string | null;
  ciudad: string | null;
  telefono: string | null;
  correo: string | null;
}

export default function AvisoLavaderoPage() {
  const { slug = '' } = useParams();
  const [lav, setLav] = useState<Lavadero | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api<Lavadero>(`/publico/lavaderos/${encodeURIComponent(slug)}`)
      .then(setLav)
      .catch(() => setError(true));
  }, [slug]);

  if (error) {
    return (
      <PaginaLegal titulo="Aviso de privacidad" version={VERSION_AVISO_LAVADERO}>
        <p>No encontramos este lavadero. Revisa el enlace o pídeselo de nuevo al lavadero.</p>
      </PaginaLegal>
    );
  }
  if (!lav) {
    return <div className="min-h-screen bg-gray-50" aria-busy="true" />;
  }

  const contacto = [lav.telefono, lav.correo].filter(Boolean).join(' · ');

  return (
    <PaginaLegal
      titulo={`Aviso de privacidad de ${lav.nombre}`}
      subtitulo="Qué datos tuyos guardamos cuando traes tu vehículo, para qué, y cómo ejercer tus derechos."
      version={VERSION_AVISO_LAVADERO}
    >
      <Seccion titulo="Quién es el responsable de tus datos">
        <p>
          <strong className="text-gray-900">{lav.nombre}</strong>
          {lav.razonSocial ? <>, de {lav.razonSocial}</> : null}
          {lav.nit ? <>, NIT {lav.nit}</> : null}.
        </p>
        <p>
          Dirección: <Dato valor={[lav.direccion, lav.ciudad].filter(Boolean).join(', ')} falta="dirección del lavadero" />.
          Contacto: <Dato valor={contacto} falta="teléfono o correo del lavadero" />.
        </p>
        <p>
          El lavadero usa <strong className="text-gray-900">Qlarity</strong>, un software de gestión, para guardar y procesar
          estos datos por su cuenta. Qlarity no los usa para nada propio.
        </p>
      </Seccion>

      <Seccion titulo="Qué datos guardamos">
        <ul className="list-disc pl-5 space-y-1">
          <li>Tu nombre, teléfono y, si nos los das, tu correo y tu número de documento.</li>
          <li>La placa, el tipo, la marca, el modelo y el color de tu vehículo.</li>
          <li>Tus turnos, los servicios que te hicimos y tus pagos.</li>
          <li>Si nos escribes por WhatsApp a través de nuestro asistente: el texto de tus mensajes.</li>
        </ul>
      </Seccion>

      <Seccion titulo="Para qué">
        <ul className="list-disc pl-5 space-y-1">
          <li>Agendar y atender tus servicios, y avisarte cuando tu vehículo esté listo.</li>
          <li>Guardar tu historial para atenderte mejor la próxima vez.</li>
          <li>Recordarte tus citas y los mantenimientos que tu vehículo necesite.</li>
          <li>Facturarte, si lo pides.</li>
        </ul>
        <p>No vendemos ni compartimos tus datos con terceros con fines comerciales o publicitarios.</p>
      </Seccion>

      <Seccion titulo="Tus derechos">
        <p>
          Puedes conocer, actualizar y corregir tus datos; pedir prueba de esta autorización; saber cómo los usamos; revocar
          la autorización y pedir que los suprimamos; y presentar una queja ante la Superintendencia de Industria y
          Comercio. No dar datos opcionales, como el correo o el documento, no te impide recibir el servicio.
        </p>
        <p>
          Para ejercerlos, escríbenos o pregúntanos en el lavadero: <Dato valor={contacto} falta="teléfono o correo del lavadero" />.
          Si usas nuestro WhatsApp, también puedes escribir <em>MIS DATOS</em> o <em>BORRAR MIS DATOS</em>.
        </p>
      </Seccion>

      <Seccion titulo="Política completa">
        <p>
          Los detalles de cómo se guardan y protegen tus datos, en qué servidores y por cuánto tiempo están en la{' '}
          <Link to="/privacidad" className="text-brand-700 font-semibold hover:underline">política de tratamiento de datos de Qlarity</Link>.
        </p>
      </Seccion>
    </PaginaLegal>
  );
}
