import { defineConfig } from 'vitest/config';
import path from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths({ projects: [path.resolve(__dirname, '../../tsconfig.base.json')] })],
  resolve: {
    // @alga-psa/ui publishes ./lib/* from dist, which tests do not build, so
    // resolve it from source the way the other packages' configs do.
    alias: [
      { find: /^@alga-psa\/ui$/, replacement: path.resolve(__dirname, '../ui/src/index.ts') },
      { find: /^@alga-psa\/ui\/(.*)$/, replacement: `${path.resolve(__dirname, '../ui/src')}/$1` },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    testTimeout: 10000,
  },
});
