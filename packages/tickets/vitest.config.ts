import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    sequence: { concurrent: false, shuffle: false },
    coverage: { enabled: false },
  },
  resolve: {
    alias: [
      { find: /^@alga-psa\/ui$/, replacement: path.resolve(__dirname, '../ui/src/index.ts') },
      { find: /^@alga-psa\/ui\/(.*)$/, replacement: path.resolve(__dirname, '../ui/src/$1') },
      { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../types/src/index.ts') },
      { find: /^@alga-psa\/types\/(.*)$/, replacement: path.resolve(__dirname, '../types/src/$1') },
      { find: /^@alga-psa\/event-schemas$/, replacement: path.resolve(__dirname, '../event-schemas/src/index.ts') },
      { find: /^@alga-psa\/event-schemas\/(.*)$/, replacement: path.resolve(__dirname, '../event-schemas/src/$1') },
      { find: /^@shared$/, replacement: path.resolve(__dirname, '../../shared') },
      { find: /^@shared\/(.*)$/, replacement: path.resolve(__dirname, '../../shared/$1') },
    ],
  },
});
