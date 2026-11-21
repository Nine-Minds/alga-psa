import { defineConfig } from 'vitest/config';
import path from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { exportedSourceAliases } from '../../scripts/lib/vitest-exported-source-aliases.mjs';

export default defineConfig({
  plugins: [
    tsconfigPaths({
      projects: [path.resolve(__dirname, '../../tsconfig.base.json')],
    }),
  ],
  test: {
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
      { find: /^@alga-psa\/db$/, replacement: path.resolve(__dirname, '../db/src/index.ts') },
      // Published @alga-psa/db subpaths come from its exports map (most live under src/lib).
      ...exportedSourceAliases('@alga-psa/db', path.resolve(__dirname, '../db')),
      { find: /^@alga-psa\/db\/models\/(.*)$/, replacement: path.resolve(__dirname, '../db/src/models/$1') },
      { find: /^@alga-psa\/db\/(.*)$/, replacement: path.resolve(__dirname, '../db/src/$1') },
      { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../types/src/index.ts') },
      { find: /^@alga-psa\/types\/(.*)$/, replacement: path.resolve(__dirname, '../types/src/$1') },
      { find: /^@alga-psa\/core$/, replacement: path.resolve(__dirname, '../core/src/index.ts') },
      { find: /^@alga-psa\/core\/logger$/, replacement: path.resolve(__dirname, '../core/src/lib/logger.ts') },
      { find: /^@alga-psa\/core\/encryption$/, replacement: path.resolve(__dirname, '../core/src/lib/encryption.ts') },
      { find: /^@alga-psa\/core\/(.*)$/, replacement: path.resolve(__dirname, '../core/src/lib/$1') },
      { find: /^@alga-psa\/authorization$/, replacement: path.resolve(__dirname, './src/index.ts') },
      { find: /^@alga-psa\/authorization\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
    ],
  },
});
