import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Adapter smoke tests import real application code. Resolve workspace source
  // explicitly so a clean emulator image job does not depend on unrelated dist.
  plugins: [tsconfigPaths({ projects: [fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url))] })],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
