import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The billing export points at TypeScript source (bundled by tsup for
      // runtime); vitest needs a direct file alias to transform it.
      '@alga-psa/billing/testing/qboSimulator': resolve(
        __dirname,
        '../../billing/src/services/accountingSync/testing/qboSimulator.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
