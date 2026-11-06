import { defineConfig } from 'vitest/config';
import serverConfig from './vitest.config';

/** Explicit disposable-database lane; never recreates or mutates a developer database. */
export default defineConfig({
  ...serverConfig,
  test: {
    ...serverConfig.test,
    projects: undefined,
    include: ['src/lib/migrations/ampWorkspace.db.test.ts'],
    setupFiles: [], globalSetup: [], coverage: { enabled: false },
    environment: 'node', fileParallelism: false, testTimeout: 120_000, hookTimeout: 120_000,
  },
});
