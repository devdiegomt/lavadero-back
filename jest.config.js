/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  testTimeout: 15000,

  // Las suites de integración comparten una sola Postgres y un solo Redis.
  // En paralelo se pisan: el flushdb() del beforeAll de una borra la sesión de
  // agendamiento que otra tiene a mitad de conversación, y las aserciones
  // sobre "el último turno creado" leen filas de la suite vecina. Daba un
  // fallo intermitente, ~1 de cada 8 corridas.
  maxWorkers: 1,

  testMatch: [
    '**/__tests__/**/*.test.ts'
  ],

  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true
        }
      }
    ]
  },

  moduleFileExtensions: ['ts', 'js', 'json'],

  clearMocks: true
};