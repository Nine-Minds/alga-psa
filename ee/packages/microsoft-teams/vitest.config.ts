import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Package sources reach `shared` through the same @shared alias the server
  // build supplies; the package's own runner has to resolve it too.
  resolve: {
    alias: [{ find: '@shared', replacement: path.resolve(__dirname, '../../../shared') }],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    testTimeout: 10000,
  },
});
