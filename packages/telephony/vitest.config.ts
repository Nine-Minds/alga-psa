import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 10000,
  },
  resolve: {
    alias: [
      { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../types/src') },
      { find: /^@alga-psa\/ui$/, replacement: path.resolve(__dirname, '../ui/src/index.ts') },
      { find: /^@alga-psa\/ui\/(.*)$/, replacement: path.resolve(__dirname, '../ui/src/$1') },
    ],
  },
});
