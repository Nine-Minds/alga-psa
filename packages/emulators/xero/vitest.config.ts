import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: {
    // Resolve mocked infrastructure from source on clean CI, before Vite applies
    // vi.mock; no application dist build is required by consumer tests.
    '@alga-psa/db': resolve(__dirname, '../../db/src/index.ts'),
    '@alga-psa/core/secrets': resolve(__dirname, '../../core/src/lib/secrets/index.ts'),
    '@alga-psa/core/logger': resolve(__dirname, '../../core/src/lib/logger.ts'),
    '@alga-psa/core': resolve(__dirname, '../../core/src/index.ts'),
  } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
