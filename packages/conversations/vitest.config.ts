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
      { find: /^@alga-psa\/db$/, replacement: pkg('db') },
      { find: /^@alga-psa\/db\/(.*)$/, replacement: path.resolve(__dirname, '../db/src/$1') },
      { find: /^@alga-psa\/storage\/(.*)$/, replacement: path.resolve(__dirname, '../storage/src/$1') },
      { find: /^@alga-psa\/conversations$/, replacement: pkg('conversations') },
      { find: /^@alga-psa\/conversations\/files$/, replacement: path.resolve(__dirname, './src/files/index.ts') },
      { find: /^@alga-psa\/conversations\/files\/(.*)$/, replacement: path.resolve(__dirname, './src/files/$1.ts') },
    ],
  },
});
