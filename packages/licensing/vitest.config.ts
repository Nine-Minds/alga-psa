import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      // DB connection is not available in unit tests; the tests only exercise
      // pure functions (verifyLicense, resolveSelfHostTier) that don't call the DB.
      '@alga-psa/db/admin': path.resolve(__dirname, 'src/lib/__test-fixtures__/db-admin-stub.ts'),
      '@alga-psa/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
    },
  },
});
