import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    testTimeout: 10000,
  },
  resolve: {
    alias: [
      // Resolve @alga-psa/core from source. Without this the specifier falls
      // through to the package's exports map, which points at core/dist/*.js —
      // absent in CI, where the unit-test job never builds it. Matches the
      // alias scheduling and billing already use.
      { find: /^@alga-psa\/core$/, replacement: path.resolve(__dirname, '../core/src/index.ts') },
      { find: /^@alga-psa\/core\/(.*)$/, replacement: path.resolve(__dirname, '../core/src/lib/$1') },
    ],
  },
});
