import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@alga-psa/auth': path.resolve(__dirname, '../auth/src'),
      '@alga-psa/core': path.resolve(__dirname, '../core/src'),
      '@alga-psa/db': path.resolve(__dirname, '../db/src'),
      '@alga-psa/types': path.resolve(__dirname, '../types/src'),
      '@alga-psa/ui': path.resolve(__dirname, '../ui/src'),
      '@alga-psa/validation': path.resolve(__dirname, '../validation/src'),
    },
  },
});
