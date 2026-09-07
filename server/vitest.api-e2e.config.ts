import { defineConfig } from 'vitest/config';
import serverConfig from './vitest.config';

// HTTP API suites need an already running application and its owned database.
// Keep self-starting dev-server and Playwright suites in their own runners.
export default defineConfig({
  ...serverConfig,
  test: {
    ...serverConfig.test,
    include: ['src/test/e2e/api/**/*.e2e.test.ts'],
    exclude: ['**/node_modules/**', '**/xeroCallbackAccessLog.e2e.test.ts'],
    globalSetup: [],
    setupFiles: [],
    coverage: { provider: 'v8', enabled: false },
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false, shuffle: false },
    poolOptions: { forks: { singleFork: false } },
  },
});
