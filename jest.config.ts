import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  testTimeout: 15_000,
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json',
    },
  },
  // Limpiar mocks entre tests
  clearMocks: true,
  // No correr en paralelo (tests de integración tocan la BD)
  maxWorkers: 1,
};

export default config;