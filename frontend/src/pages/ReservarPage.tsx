/**
 * La página de reservas de un lavadero: `/reservar/:slug`.
 *
 * La abre el cliente final desde el enlace que el lavadero pone en su
 * Instagram, su WhatsApp o un QR en el mostrador. No tiene sesión ni la
 * necesita: elige tipo de vehículo, servicio, día y hora, deja sus datos, y el
 * turno aparece en la agenda del panel marcado como reserva web.
 *
 * Una sola columna y todo en una pantalla que se va completando de arriba
 * abajo: en el celular es más fácil volver a cambiar algo así que con pasos en
 * pantallas separadas. Cada sección aparece cuando la anterior está lista.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarCheck, Car, Check, Clock, MapPin, Phone } from 'lucide-react';
import MarcaQ from '../components/MarcaQ';
import CasillaAutorizacion from '../components/CasillaAutorizacion';
import { api } from '../lib/api';

type Tipo = 'sedan' | 'suv' | 'camioneta' | 'pickup' | 'moto';

const NOMBRE_TIPO: Record<Tipo, string> = {
  sedan: 'Automóvil',
  suv: 'SUV',
  camioneta: 'Camioneta',
  pickup: 'Pickup',
  moto: 'Moto',
};

interface Servicio {
  id: string;
  nombre: string;
  descripcion: string | null;
  minutos: number;
  precios: Record<Tipo, number | null>;
}

interface Datos {
  lavadero: {
    nombre: string;
    direccion: string | null;
    ciudad: string | null;
    telefono: string | null;
    apertura: string;
    cierre: string;
  };
  recibeReservas: boolean;
  tipos: Tipo[];
  servicios: Servicio[];
}

interface Dia {
  fecha: string;
  etiqueta: string;
  horas: string[];
}

interface Confirmada {
  servicio: string;
  etiqueta: string;
  fecha: string;
  hora: string;
  placa: string;
  precio: number;
}

const pesos = (n: number) => '$' + n.toLocaleString('es-CO');

/** 14:30 → 2:30 p. m. */
function hora12(h: string): string {
  const [hh, mm] = h.split(':').map(Number);
  const sufijo = hh >= 12 ? 'p. m.' : 'a. m.';
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${sufijo}`;
}

function duracion(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const CAMPO =
  'w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-600 focus:border-transparent outline-none transition text-base text-gray-900 placeholder:text-gray-400';

export default function ReservarPage() {
  const { slug = '' } = useParams();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [noExiste, setNoExiste] = useState(false);

  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [servicioId, setServicioId] = useState<string | null>(null);
  const [dias, setDias] = useState<Dia[] | null>(null);
  const [errorDias, setErrorDias] = useState<string | null>(null);
  const [fecha, setFecha] = useState<string | null>(null);
  const [hora, setHora] = useState<string | null>(null);

  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [telefono, setTelefono] = useState('');
  const [placa, setPlaca] = useState('');
  const [notas, setNotas] = useState('');
  const [sitio, setSitio] = useState('');
  const [autoriza, setAutoriza] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmada, setConfirmada] = useState<Confirmada | null>(null);

  const base = `/publico/lavaderos/${encodeURIComponent(slug)}/reservas`;

  useEffect(() => {
    api<Datos>(base)
      .then((d) => {
        setDatos(d);
        document.title = `Reservar en ${d.lavadero.nombre}`;
      })
      .catch(() => setNoExiste(true));
  }, [base]);

  const servicio = useMemo(
    () => datos?.servicios.find((s) => s.id === servicioId) ?? null,
    [datos, servicioId],
  );

  // Los horarios dependen sólo del servicio (de cuánto dura), no del tipo de
  // vehículo: se piden una vez por servicio, con todos los días de la ventana.
  const cargarDias = (id: string) => {
    setDias(null);
    setErrorDias(null);
    api<{ dias: Dia[] }>(`${base}/horarios?servicio=${id}`)
      .then((r) => {
        setDias(r.dias);
        setFecha(r.dias[0]?.fecha ?? null);
      })
      .catch((e: Error) => setErrorDias(e.message));
  };

  useEffect(() => {
    setFecha(null);
    setHora(null);
    if (servicioId) cargarDias(servicioId);
  }, [servicioId]);

  const elegirTipo = (t: Tipo) => {
    setTipo(t);
    // Si el servicio elegido no se ofrece para este tipo, se deselecciona.
    if (servicio && servicio.precios[t] === null) setServicioId(null);
  };

  const dia = dias?.find((d) => d.fecha === fecha) ?? null;
  const listoParaDatos = Boolean(tipo && servicio && fecha && hora);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!listoParaDatos || !tipo || !servicio) return;
    if (!autoriza) {
      setError('Para reservar tienes que autorizar el tratamiento de tus datos.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const r = await api<Confirmada>(base, {
        method: 'POST',
        body: {
          autorizaDatos: true,
          servicioId: servicio.id,
          tipoVehiculo: tipo,
          fecha,
          hora,
          nombre: nombre.trim(),
          apellido: apellido.trim() || null,
          telefono,
          placa,
          notas: notas.trim() || null,
          sitio,
        },
      });
      setConfirmada(r);
      window.scrollTo({ top: 0 });
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg.replace(/^Datos inválidos: /, ''));
      // Si el horario se ocupó mientras llenaba el formulario, se refrescan
      // los horarios para que elija otro sin recargar.
      if (/ocupar/.test(msg)) {
        setHora(null);
        cargarDias(servicio.id);
      }
    } finally {
      setEnviando(false);
    }
  };

  if (noExiste) {
    return (
      <Marco>
        <h1 className="text-2xl font-semibold text-gray-900">No encontramos este lavadero</h1>
        <p className="text-gray-600 mt-3">Revisa el enlace o pídeselo de nuevo al lavadero.</p>
      </Marco>
    );
  }
  if (!datos) return <div className="min-h-screen bg-gray-50" aria-busy="true" />;

  const lav = datos.lavadero;
  const lugar = [lav.direccion, lav.ciudad].filter(Boolean).join(', ');

  const cabecera = (
    <header className="mb-8">
      <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">{lav.nombre}</h1>
      <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
        {lugar && (
          <li className="flex items-start gap-2">
            <MapPin size={16} className="mt-0.5 shrink-0 text-gray-500" aria-hidden="true" /> {lugar}
          </li>
        )}
        <li className="flex items-start gap-2">
          <Clock size={16} className="mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
          {hora12(lav.apertura)} a {hora12(lav.cierre)}
        </li>
        {lav.telefono && (
          <li className="flex items-start gap-2">
            <Phone size={16} className="mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
            <a href={`tel:${lav.telefono}`} className="underline underline-offset-2">{lav.telefono}</a>
          </li>
        )}
      </ul>
    </header>
  );

  if (confirmada) {
    return (
      <Marco>
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-700 mb-5">
          <Check size={26} aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">¡Listo, quedó reservado!</h1>
        <p className="text-gray-600 mt-2">Te esperamos en {lav.nombre}.</p>
        <dl className="mt-6 bg-white border border-gray-100 rounded-xl divide-y divide-gray-100 text-sm">
          <Fila t="Servicio" v={confirmada.servicio} />
          <Fila t="Cuándo" v={`${confirmada.etiqueta}, ${hora12(confirmada.hora)}`} />
          <Fila t="Placa" v={<span className="font-mono">{confirmada.placa}</span>} />
          <Fila t="Precio" v={pesos(confirmada.precio)} />
          {lugar && <Fila t="Dónde" v={lugar} />}
        </dl>
        <p className="text-sm text-gray-600 mt-6">
          Si necesitas cambiarla o cancelarla, comunícate con el lavadero
          {lav.telefono ? <> al <a href={`tel:${lav.telefono}`} className="underline underline-offset-2">{lav.telefono}</a></> : null}.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-8 w-full py-3 border border-gray-200 text-gray-800 font-semibold rounded-lg text-sm hover:bg-gray-100 transition"
        >
          Hacer otra reserva
        </button>
      </Marco>
    );
  }

  if (!datos.recibeReservas || datos.servicios.length === 0) {
    return (
      <Marco>
        {cabecera}
        <p className="bg-white border border-gray-100 rounded-xl p-4 text-gray-700">
          Por ahora este lavadero no está recibiendo reservas en línea.
          {lav.telefono ? <> Comunícate con ellos al <a href={`tel:${lav.telefono}`} className="underline underline-offset-2">{lav.telefono}</a>.</> : null}
        </p>
      </Marco>
    );
  }

  return (
    <Marco>
      {cabecera}

      <form onSubmit={enviar} className="space-y-10" noValidate>
        <Paso n={1} titulo="¿Qué vehículo traes?">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo de vehículo">
            {datos.tipos.map((t) => (
              <Opcion key={t} activa={tipo === t} onClick={() => elegirTipo(t)}>
                <Car size={16} aria-hidden="true" className="shrink-0" /> {NOMBRE_TIPO[t]}
              </Opcion>
            ))}
          </div>
        </Paso>

        {tipo && (
          <Paso n={2} titulo="¿Qué servicio?">
            <div className="space-y-2" role="radiogroup" aria-label="Servicio">
              {datos.servicios.map((s) => {
                const precio = s.precios[tipo];
                const activa = servicioId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={activa}
                    disabled={precio === null}
                    onClick={() => setServicioId(s.id)}
                    className={`w-full text-left rounded-xl border p-4 transition disabled:opacity-50 disabled:cursor-not-allowed ${
                      activa ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold text-gray-900">{s.nombre}</span>
                      <span className="font-mono text-sm text-gray-900 whitespace-nowrap">
                        {precio === null ? 'No disponible' : pesos(precio)}
                      </span>
                    </span>
                    {s.descripcion && <span className="block text-sm text-gray-600 mt-1">{s.descripcion}</span>}
                    <span className="block text-xs text-gray-500 mt-2">Dura aprox. {duracion(s.minutos)}</span>
                  </button>
                );
              })}
            </div>
          </Paso>
        )}

        {tipo && servicio && (
          <Paso n={3} titulo="¿Cuándo?">
            {errorDias && <p role="alert" className="text-sm text-red-700">{errorDias}</p>}
            {!dias && !errorDias && <p className="text-sm text-gray-500">Buscando horarios…</p>}
            {dias && dias.length === 0 && (
              <p className="text-sm text-gray-700">
                No quedan horarios libres para este servicio en los próximos días. Prueba con otro servicio o comunícate
                con el lavadero.
              </p>
            )}
            {dias && dias.length > 0 && (
              <>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4" role="radiogroup" aria-label="Día">
                  {dias.map((d) => (
                    <Opcion
                      key={d.fecha}
                      activa={fecha === d.fecha}
                      onClick={() => {
                        setFecha(d.fecha);
                        setHora(null);
                      }}
                      angosta
                    >
                      {d.etiqueta}
                    </Opcion>
                  ))}
                </div>
                {dia && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-4" role="radiogroup" aria-label="Hora">
                    {dia.horas.map((h) => (
                      <Opcion key={h} activa={hora === h} onClick={() => setHora(h)} angosta>
                        {hora12(h)}
                      </Opcion>
                    ))}
                  </div>
                )}
              </>
            )}
          </Paso>
        )}

        {listoParaDatos && servicio && tipo && (
          <Paso n={4} titulo="Tus datos">
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Campo id="nombre" etiqueta="Nombre">
                  <input id="nombre" className={CAMPO} value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="given-name" required maxLength={80} />
                </Campo>
                <Campo id="apellido" etiqueta="Apellido (opcional)">
                  <input id="apellido" className={CAMPO} value={apellido} onChange={(e) => setApellido(e.target.value)} autoComplete="family-name" maxLength={80} />
                </Campo>
              </div>
              <Campo id="telefono" etiqueta="Celular">
                <input id="telefono" className={CAMPO} value={telefono} onChange={(e) => setTelefono(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="300 123 4567" required maxLength={20} />
              </Campo>
              <Campo id="placa" etiqueta="Placa">
                <input id="placa" className={`${CAMPO} font-mono uppercase`} value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} autoCapitalize="characters" placeholder="ABC123" required maxLength={8} />
              </Campo>
              <Campo id="notas" etiqueta="¿Algo que debamos saber? (opcional)">
                <textarea id="notas" className={CAMPO} value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} maxLength={300} />
              </Campo>

              {/* Campo trampa: fuera de la pantalla y fuera del orden de tabulación. */}
              <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
                <label htmlFor="sitio">Sitio web</label>
                <input id="sitio" tabIndex={-1} autoComplete="off" value={sitio} onChange={(e) => setSitio(e.target.value)} />
              </div>

              <CasillaAutorizacion
                id="autoriza"
                marcada={autoriza}
                onCambio={setAutoriza}
                enlace={`/privacidad/${slug}`}
                textoEnlace="Ver aviso de privacidad"
              >
                Autorizo a {lav.nombre} a guardar mis datos para agendar y atender mi servicio.
              </CasillaAutorizacion>

              <div className="bg-white border border-gray-100 rounded-xl p-4 text-sm">
                <p className="etiqueta text-gray-500 mb-2">Tu reserva</p>
                <p className="text-gray-900 font-semibold">{servicio.nombre} · {NOMBRE_TIPO[tipo]}</p>
                <p className="text-gray-700 mt-1">{dia?.etiqueta}, {hora && hora12(hora)}</p>
                <p className="font-mono text-gray-900 mt-1">{pesos(servicio.precios[tipo] ?? 0)}</p>
              </div>

              {error && (
                <div role="alert" className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={enviando}
                className="w-full py-3.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                <CalendarCheck size={18} aria-hidden="true" />
                {enviando ? 'Reservando…' : 'Confirmar reserva'}
              </button>
              <p className="text-xs text-gray-500 text-center">Pagas en el lavadero cuando recibas tu vehículo.</p>
            </div>
          </Paso>
        )}
      </form>
    </Marco>
  );
}

function Marco({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <main className="max-w-xl mx-auto">
        {children}
        <footer className="mt-14 pt-6 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-500">
          <MarcaQ size={14} className="text-brand-600" />
          Reservas con Qlarity
        </footer>
      </main>
    </div>
  );
}

function Paso({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`paso-${n}`}>
      <h2 id={`paso-${n}`} className="flex items-center gap-3 text-lg font-semibold text-gray-900 mb-4">
        <span className="font-mono text-sm text-brand-700" aria-hidden="true">{String(n).padStart(2, '0')}</span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Opcion({
  activa,
  onClick,
  angosta,
  children,
}: {
  activa: boolean;
  onClick(): void;
  angosta?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activa}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border text-sm font-medium transition whitespace-nowrap ${
        angosta ? 'px-3 py-2.5' : 'px-4 py-3'
      } ${activa ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-200 bg-white text-gray-800 hover:border-gray-300'}`}
    >
      {children}
    </button>
  );
}

function Campo({ id, etiqueta, children }: { id: string; etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block etiqueta text-gray-500 mb-2">{etiqueta}</label>
      {children}
    </div>
  );
}

function Fila({ t, v }: { t: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-3">
      <dt className="text-gray-500">{t}</dt>
      <dd className="text-gray-900 text-right">{v}</dd>
    </div>
  );
}
