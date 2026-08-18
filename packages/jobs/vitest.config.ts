import path from 'node:path';
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@alga-psa\/shared\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../../shared')}/$1`,
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    testTimeout: 10000,
  },
  resolve: {
    alias: [
      // The hour-block handler suites in tests/ import workspace packages whose
      // exports maps point at dist builds that this package's test runs do not
      // produce; resolve them to source like the other package vitest configs.
      { find: /^@alga-psa\/core$/, replacement: path.resolve(__dirname, '../core/src/index.ts') },
      { find: /^@alga-psa\/db$/, replacement: path.resolve(__dirname, '../db/src/index.ts') },
      { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../types/src/index.ts') },
      { find: /^@alga-psa\/event-bus$/, replacement: path.resolve(__dirname, '../event-bus/src/index.ts') },
      { find: /^@alga-psa\/event-bus\/publishers$/, replacement: path.resolve(__dirname, '../event-bus/src/publishers/index.ts') },
      { find: /^@alga-psa\/shared$/, replacement: path.resolve(__dirname, '../../shared') },
      { find: /^@alga-psa\/shared\/(.*)$/, replacement: path.resolve(__dirname, '../../shared/$1') },
    ],
  },
});
