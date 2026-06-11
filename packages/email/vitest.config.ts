import { defineConfig } from 'vitest/config';
import path from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    tsconfigPaths({
      projects: [path.resolve(__dirname, '../../tsconfig.base.json')],
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
    },
    include: ['src/**/*.test.{ts,tsx}'],
    sequence: { concurrent: false, shuffle: false },
    coverage: { enabled: false },
  },
  resolve: {
    alias: [
      { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../types/src/index.ts') },
      { find: /^@alga-psa\/types\/(.*)$/, replacement: path.resolve(__dirname, '../types/src/$1') },
      { find: /^@alga-psa\/db$/, replacement: path.resolve(__dirname, '../db/src/index.ts') },
      { find: /^@alga-psa\/db\/admin$/, replacement: path.resolve(__dirname, '../db/src/lib/admin.ts') },
      { find: /^@alga-psa\/db\/(.*)$/, replacement: path.resolve(__dirname, '../db/src/$1') },
      { find: /^@alga-psa\/core$/, replacement: path.resolve(__dirname, '../core/src/index.ts') },
      { find: /^@alga-psa\/core\/server$/, replacement: path.resolve(__dirname, '../core/src/server.ts') },
      { find: /^@alga-psa\/core\/context\/(.*)$/, replacement: path.resolve(__dirname, '../core/src/context/$1') },
      { find: /^@alga-psa\/core\/(.*)$/, replacement: path.resolve(__dirname, '../core/src/lib/$1') },
      { find: /^@alga-psa\/auth$/, replacement: path.resolve(__dirname, '../auth/src/index.ts') },
      { find: /^@alga-psa\/auth\/(.*)$/, replacement: path.resolve(__dirname, '../auth/src/$1') },
      { find: /^@alga-psa\/email$/, replacement: path.resolve(__dirname, './src/index.ts') },
      { find: /^@alga-psa\/email\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
      { find: /^@alga-psa\/shared$/, replacement: path.resolve(__dirname, '../../shared') },
      { find: /^@alga-psa\/shared\/(.*)$/, replacement: path.resolve(__dirname, '../../shared/$1') },
      { find: /^@shared$/, replacement: path.resolve(__dirname, '../../shared') },
      { find: /^@shared\/(.*)$/, replacement: path.resolve(__dirname, '../../shared/$1') },
      // Generic catch-all for any remaining @alga-psa/* workspace packages.
      { find: /^@alga-psa\/([^/]+)\/(.*)$/, replacement: `${path.resolve(__dirname, '..')}/$1/src/$2` },
      { find: /^@alga-psa\/([^/]+)$/, replacement: `${path.resolve(__dirname, '..')}/$1/src` },
    ],
  },
});
