import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: [
      { find: /^@alga-psa\/types(.*)$/, replacement: path.resolve(__dirname, '../types/src$1') },
      { find: /^@alga-psa\/event-bus(.*)$/, replacement: path.resolve(__dirname, '../event-bus/src$1') },
      { find: /^@alga-psa\/event-schemas(.*)$/, replacement: path.resolve(__dirname, '../event-schemas/src$1') },
      { find: /^@alga-psa\/core$/, replacement: path.resolve(__dirname, '../core/src/index.ts') },
      { find: /^@alga-psa\/core\/(.*)$/, replacement: path.resolve(__dirname, '../core/src/lib/$1') },
      { find: /^@alga-psa\/workflows(.*)$/, replacement: path.resolve(__dirname, '../../ee/packages/workflows/src$1') },
    ],
  },
});
