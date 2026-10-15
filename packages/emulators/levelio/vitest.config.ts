import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The consumer test drives Alga's real LevelIoApiClient, which imports
      // the secrets provider at module load. Vite resolves imports before
      // vi.mock applies, so point it at source rather than an app dist build.
      '@alga-psa/core/secrets': resolve(__dirname, '../../core/src/lib/secrets/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
