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
    alias: [
      { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../types/src') },
      { find: /^@alga-psa\/types\/(.*)$/, replacement: `${path.resolve(__dirname, '../types/src')}/$1` },
      // @alga-psa/ui publishes ./lib/* from dist, which tests do not build; the
      // boundary helper reaches lib/i18n/serverOnly, so resolve ui from source
      // the way the other packages' configs do.
      { find: /^@alga-psa\/ui$/, replacement: path.resolve(__dirname, '../ui/src/index.ts') },
      { find: /^@alga-psa\/ui\/(.*)$/, replacement: `${path.resolve(__dirname, '../ui/src')}/$1` },
      { find: /^@alga-psa\/db\/admin$/, replacement: path.resolve(__dirname, '../db/src/lib/admin.ts') },
      { find: /^@alga-psa\/db\/models$/, replacement: path.resolve(__dirname, '../db/src/models/index.ts') },
      { find: /^@alga-psa\/db\/models\/(.*)$/, replacement: `${path.resolve(__dirname, '../db/src/models')}/$1` },
      { find: /^@alga-psa\/db\/(.*)$/, replacement: `${path.resolve(__dirname, '../db/src/lib')}/$1` },
      { find: /^@alga-psa\/db$/, replacement: path.resolve(__dirname, '../db/src/index.ts') },
    ],
  },
});

