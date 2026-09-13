/**
 * Una sola forma de escribir un teléfono.
 *
 * El bug que cierra esto: un cliente cargado desde el panel como `3223772019`
 * quedó duplicado la primera vez que escribió por WhatsApp, porque bot-wa manda
 * `+573223772019` y la búsqueda compara `phone = $1` como texto. Dos filas, el
 * historial partido y `visit_count` contando la mitad en cada una.
 *
 * Lo que más importa probar es lo que la función **no** hace: inventar un
 * indicativo donde no hay con qué deducirlo. Un teléfono mal escrito se ve y se
 * corrige; uno inventado parece correcto.
 */
import { normalizarTelefono, esCanonico } from '../src/shared/utils/telefono';

describe('normalizarTelefono: lo mismo escrito de varias formas', () => {
  // El caso real que motivó todo esto.
  it('un celular de diez dígitos se enlaza con el que manda bot-wa', () => {
    expect(normalizarTelefono('3223772019')).toBe('+573223772019');
    expect(normalizarTelefono('+573223772019')).toBe('+573223772019');
  });

  it.each([
    ['+57 322 377 2019', 'con espacios'],
    ['+57-322-377-2019', 'con guiones'],
    ['(+57) 322 377 2019', 'con paréntesis'],
    ['573223772019', 'con indicativo pero sin el +'],
    ['0057 322 377 2019', 'con el prefijo internacional viejo'],
    ['+57.322.377.2019', 'con puntos'],
    ['  +573223772019  ', 'con espacios de sobra'],
  ])('%s (%s) → +573223772019', (entrada) => {
    expect(normalizarTelefono(entrada)).toBe('+573223772019');
  });

  it('es idempotente: normalizar lo ya normalizado no lo cambia', () => {
    const una = normalizarTelefono('322 377 2019');
    expect(normalizarTelefono(una)).toBe(una);
  });

  it('un fijo del formato nuevo también lleva indicativo', () => {
    // 601… es Bogotá desde 2022; son diez dígitos, igual que un celular.
    expect(normalizarTelefono('6017654321')).toBe('+576017654321');
  });
});

describe('lo que NO hace: inventar', () => {
  it('un fijo viejo de siete dígitos se deja quieto', () => {
    // Sin indicativo de área no hay forma de saber de qué ciudad es. Ponerle
    // +57 delante produciría un número que no existe, y eso es peor que
    // dejarlo raro: un dato inventado no se nota.
    expect(normalizarTelefono('7654321')).toBe('7654321');
    expect(esCanonico(normalizarTelefono('7654321'))).toBe(false);
  });

  it('un número de otro país con + se respeta tal cual', () => {
    expect(normalizarTelefono('+1 305 555 0123')).toBe('+13055550123');
    expect(normalizarTelefono('+34 600 000 000')).toBe('+34600000000');
  });

  it('diez dígitos que no son celular ni fijo colombiano no se tocan', () => {
    // Empieza por 4: no corresponde a ningún plan de numeración nacional, así
    // que suponer Colombia sería suponer.
    expect(normalizarTelefono('4123456789')).toBe('4123456789');
  });

  it('sin dígitos no hay teléfono', () => {
    expect(normalizarTelefono('')).toBeNull();
    expect(normalizarTelefono('   ')).toBeNull();
    expect(normalizarTelefono('---')).toBeNull();
    expect(normalizarTelefono(null)).toBeNull();
    expect(normalizarTelefono(undefined)).toBeNull();
    expect(normalizarTelefono(573223772019)).toBeNull();
  });
});

describe('esCanonico', () => {
  it('distingue lo canónico de lo que sólo quedó limpio', () => {
    expect(esCanonico('+573223772019')).toBe(true);
    expect(esCanonico('3223772019')).toBe(false);
    expect(esCanonico('7654321')).toBe(false);
    expect(esCanonico(null)).toBe(false);
  });
});
