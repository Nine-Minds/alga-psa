import { defineConfig } from 'vitest/config';
import serverConfig from './vitest.config';

export default defineConfig({
  ...serverConfig,
  test: {
    ...serverConfig.test,
    projects: undefined,
    include: ['test-workers/coldRbacFreshProcess.test.ts'],
    setupFiles: [],
    globalSetup: [],
    fileParallelism: false,
    maxWorkers: 1,
    coverage: { provider: 'v8', enabled: false },
  },
});
