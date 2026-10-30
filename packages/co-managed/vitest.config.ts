import { defineConfig } from 'vitest/config';
import path from 'path';

const pkg = (name: string, sub = 'src/index.ts') => path.resolve(__dirname, `../${name}/${sub}`);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: [
      { find: /^@alga-psa\/core\/capability\/testing$/, replacement: pkg('core', 'src/capability/testing.ts') },
      { find: /^@alga-psa\/core\/capability$/, replacement: pkg('core', 'src/lib/capability.ts') },
      { find: /^@alga-psa\/core\/features$/, replacement: pkg('core', 'src/lib/features.ts') },
      { find: /^@alga-psa\/core\/logger$/, replacement: pkg('core', 'src/lib/logger.ts') },
      { find: /^@alga-psa\/core$/, replacement: pkg('core') },
      { find: /^@alga-psa\/db$/, replacement: pkg('db') },
      { find: /^@alga-psa\/db\/(.*)$/, replacement: path.resolve(__dirname, '../db/src/$1') },
      { find: /^@alga-psa\/authorization$/, replacement: pkg('authorization') },
      { find: /^@alga-psa\/authorization\/(.*)$/, replacement: path.resolve(__dirname, '../authorization/src/$1') },
      { find: /^@alga-psa\/types$/, replacement: pkg('types') },
      { find: /^@alga-psa\/licensing$/, replacement: pkg('licensing') },
      { find: /^@alga-psa\/licensing\/(.*)$/, replacement: path.resolve(__dirname, '../licensing/src/$1') },
      { find: /^@alga-psa\/shared\/(.*)$/, replacement: path.resolve(__dirname, '../../shared/$1') },
      { find: /^@alga-psa\/co-managed$/, replacement: pkg('co-managed') },
      { find: /^@alga-psa\/co-managed\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
    ],
  },
});
