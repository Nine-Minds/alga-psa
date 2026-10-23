import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['../ui/vitest.setup.ts'],
    sequence: { concurrent: false, shuffle: false },
    coverage: { enabled: false },
  },
  resolve: {
    alias: [
      // Resolve sibling packages to source so tests never read a stale dist/.
      { find: /^@alga-psa\/ui(.*)$/, replacement: path.resolve(__dirname, '../ui/src$1') },
      { find: '@alga-psa/types', replacement: path.resolve(__dirname, '../types/src') },
      { find: /^@alga-psa\/list-views(.*)$/, replacement: path.resolve(__dirname, 'src$1') },
      {
        find: /^@alga-psa\/core\/i18n\/countryDateFormat$/,
        replacement: path.resolve(__dirname, '../core/src/lib/i18n/countryDateFormat.ts'),
      },
    ],
  },
});
