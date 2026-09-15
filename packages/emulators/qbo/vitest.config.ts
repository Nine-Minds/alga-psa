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
      // Consumer tests mock DB/secrets infrastructure, but Vite resolves those
      // imports before applying vi.mock. Use source entries so a clean emulator
      // test run needs no application dist builds. Core errors remain real.
      '@alga-psa/db': resolve(__dirname, '../../db/src/index.ts'),
      '@alga-psa/core/secrets': resolve(__dirname, '../../core/src/lib/secrets/index.ts'),
      '@alga-psa/core/logger': resolve(__dirname, '../../core/src/lib/logger.ts'),
      '@alga-psa/core': resolve(__dirname, '../../core/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
