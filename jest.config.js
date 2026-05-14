/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  testTimeout: 15000,

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