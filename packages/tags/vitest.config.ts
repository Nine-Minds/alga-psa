import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolve @alga-psa/* to workspace sources (as packages/clients does) so
  // component tests can import and mock sibling packages.
  plugins: [tsconfigPaths({ ignoreConfigErrors: true })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    testTimeout: 10000,
  },
});
