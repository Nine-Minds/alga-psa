import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    globalSetup: ['./vitest.globalSetup.js'],
    isolate: true,
    sequence: {
      concurrent: false,
      shuffle: true
    },
    pool: 'forks',
    poolOptions: {
      threads: {
        singleThread: true
      },
      forks: {
        singleFork: true
      }
    },
    logHeapUsage: true,
    testTimeout: 30000, // Increased for integration tests
    include: [
      'src/__tests__/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'src/__tests__/**/*.playwright.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'src/components/**/__tests__/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'
    ]
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
      '@main-server': path.resolve(__dirname, '../../server/src'),
      '@main-test-utils': path.resolve(__dirname, '../../server/test-utils'),
      'server': path.resolve(__dirname, '../../server'),
      '@shared/core/secretProvider': path.resolve(__dirname, '../shared/core/secretProvider.ts'),
      '@shared/core/logger': path.resolve(__dirname, '../shared/core/logger.ts'),
    },
  },
});