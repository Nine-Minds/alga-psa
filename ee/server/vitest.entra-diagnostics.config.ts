import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.unit.config';

// Uses an explicitly supplied, already migrated disposable database. Unlike
// the general integration bootstrap, this lane never drops/recreates a DB.
export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    include: ['src/__tests__/integration/entraDiagnostics.integration.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
