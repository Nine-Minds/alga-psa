import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    testTimeout: 10000,
  },
  resolve: {
    // Workspace packages publish narrow exports maps; the suites import source
    // subpaths (the server vitest config resolves them the same way).
    alias: [
      { find: /^@alga-psa\/shared\/(.*)$/, replacement: path.resolve(__dirname, '../../../shared') + '/$1' },
      { find: /^@alga-psa\/scheduling\/(.*)$/, replacement: path.resolve(__dirname, '../../../packages/scheduling/src') + '/$1' },
    ],
  },
});
