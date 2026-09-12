import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    testTimeout: 10000,
  },
  resolve: {
    // Workspace packages are consumed from source in the app (tsconfig paths +
    // transpilePackages); mirror that here so deep imports resolve in tests too.
    alias: [
      { find: /^@alga-psa\/([^/]+)\/(.*)$/, replacement: `${path.resolve(__dirname, '..')}/$1/src/$2` },
    ],
  },
});
