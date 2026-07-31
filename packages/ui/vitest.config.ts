import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    sequence: { concurrent: false, shuffle: false },
    coverage: { enabled: false },
  },
  resolve: {
    alias: [
      // Components inside this package import their siblings through the
      // published package name; resolve those to src so tests don't need a
      // pre-built dist/.
      { find: /^@alga-psa\/ui(.*)$/, replacement: path.resolve(__dirname, 'src$1') },
    ],
  },
});
