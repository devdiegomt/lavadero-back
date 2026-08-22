/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  testTimeout: 15000,

  // Cargar .env antes de cada suite. Sin esto solo funcionan los tests que
  // importan src/index (que hace el require de dotenv de refilon); los que
  // prueban un modulo suelto se conectan al 5432 por defecto y fallan.
  setupFiles: ['dotenv/config'],

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