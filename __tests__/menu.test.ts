/**
 * Interpretación de las respuestas a los menús numerados.
 *
 * Sale de una prueba real: el bot mostró «1️⃣ Sedán / Auto» y el cliente
 * respondió «Sedan». El bot contestó «Escribe un número del 1 al 4» — correcto
 * y a la vez una mala respuesta, porque el cliente había entendido y había
 * contestado bien.
 *
 * Lo que más importa acá no es lo que acepta, sino **lo que se niega a
 * adivinar**. Un menú que interpreta de más elige por el cliente, y en este
 * flujo eso termina en un turno agendado para el servicio equivocado.
 */
import { elegirOpcion, elegirTipoVehiculo, normalizar } from '../src/modules/whatsapp/menu';

describe('normalizar', () => {
  it('quita tildes, mayúsculas y espacios de más', () => {
    expect(normalizar('  SEDÁN  ')).toBe('sedan');
    expect(normalizar('Lavado   Básico')).toBe('lavado basico');
    expect(normalizar('Camión')).toBe('camion');
  });

  it('tolera nulos sin reventar', () => {
    expect(normalizar(undefined as unknown as string)).toBe('');
    expect(normalizar(null as unknown as string)).toBe('');
  });
});

describe('tipo de vehículo', () => {
  it('acepta el número, que sigue siendo lo que pide el menú', () => {
    expect(elegirTipoVehiculo('1')).toBe('sedan');
    expect(elegirTipoVehiculo('2')).toBe('suv');
    expect(elegirTipoVehiculo('3')).toBe('pickup');
    expect(elegirTipoVehiculo('4')).toBe('moto');
  });

  it('acepta la palabra que el propio menú mostró', () => {
    // El caso literal de la prueba en producción.
    expect(elegirTipoVehiculo('Sedan')).toBe('sedan');
    expect(elegirTipoVehiculo('sedán')).toBe('sedan');
    expect(elegirTipoVehiculo('SUV')).toBe('suv');
    expect(elegirTipoVehiculo('Camioneta')).toBe('suv');
    expect(elegirTipoVehiculo('  moto ')).toBe('moto');
  });

  it('acepta como habla la gente, no como está en la base', () => {
    expect(elegirTipoVehiculo('carro')).toBe('sedan');
    expect(elegirTipoVehiculo('pick up')).toBe('pickup');
    expect(elegirTipoVehiculo('motocicleta')).toBe('moto');
  });

  it('entiende la palabra dentro de una frase', () => {
    expect(elegirTipoVehiculo('es una camioneta')).toBe('suv');
    expect(elegirTipoVehiculo('quiero lavar mi moto')).toBe('moto');
  });

  it('no inventa cuando no entiende', () => {
    for (const t of ['', '   ', 'xyz', 'no sé', '9', '0', 'lo de siempre']) {
      expect(elegirTipoVehiculo(t)).toBeNull();
    }
  });
});

describe('elegirOpcion', () => {
  const servicios = [
    { claves: ['Lavado Express'] },
    { claves: ['Lavado Básico'] },
    { claves: ['Lavado Completo'] },
    { claves: ['Detailing'] },
  ];

  it('el número tiene prioridad sobre el texto', () => {
    // Con un menú donde una opción se llama «2 manos», un «2» tiene que seguir
    // significando la segunda opción y no la que lleva ese número en el nombre.
    const ambiguo = [{ claves: ['Encerado'] }, { claves: ['Pulido 2 manos'] }];
    expect(elegirOpcion('2', ambiguo)).toBe(1);
    expect(elegirOpcion('1', ambiguo)).toBe(0);
  });

  it('acepta el nombre del servicio, con o sin tildes', () => {
    expect(elegirOpcion('Lavado Básico', servicios)).toBe(1);
    expect(elegirOpcion('lavado basico', servicios)).toBe(1);
    expect(elegirOpcion('DETAILING', servicios)).toBe(3);
  });

  it('acepta el nombre dentro de una frase', () => {
    expect(elegirOpcion('quiero el lavado completo', servicios)).toBe(2);
  });

  it('ante dos coincidencias no elige: pregunta de nuevo', () => {
    // «lavado» está en tres servicios. Elegir uno sería inventar cuál quiso, y
    // el cliente terminaría con un turno de $15.000 o de $120.000 sin saberlo.
    expect(elegirOpcion('lavado', servicios)).toBeNull();
    expect(elegirOpcion('quiero un lavado', servicios)).toBeNull();
  });

  it('un número fuera de rango no es una opción', () => {
    expect(elegirOpcion('0', servicios)).toBeNull();
    expect(elegirOpcion('5', servicios)).toBeNull();
    expect(elegirOpcion('99', servicios)).toBeNull();
  });

  it('sin opciones no hay nada que elegir', () => {
    expect(elegirOpcion('1', [])).toBeNull();
  });

  it('las claves cortas no se buscan dentro de la frase', () => {
    // «uno» aparece dentro de «ninguno». Buscar claves de 3 letras dentro del
    // texto elegiría por el cliente sin que lo haya pedido.
    const cortas = [{ claves: ['uno'] }, { claves: ['dos'] }];
    expect(elegirOpcion('ninguno de esos', cortas)).toBeNull();
    // Pero exacta sí, porque ahí no hay ambigüedad.
    expect(elegirOpcion('uno', cortas)).toBe(0);
  });
});
