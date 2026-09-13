import { defineConfig } from 'vitest/config';
import serverConfig from './vitest.config';

// HTTP API suites need an already running application and its owned database.
// The Xero access-log regression additionally starts an isolated dev server:
// its subject is Next's development access logger, not the built app's logger.
// Playwright suites retain their own runner.
export default defineConfig({
  ...serverConfig,
  test: {
    ...serverConfig.test,
    include: ['src/test/e2e/api/**/*.e2e.test.ts', 'src/test/e2e/serverRenderedLocale.e2e.test.ts', 'src/test/e2e/utils/utilities.test.ts'],
    exclude: ['**/node_modules/**'],
    globalSetup: [],
    setupFiles: [],
    coverage: { provider: 'v8', enabled: false },
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false, shuffle: false },
    poolOptions: { forks: { singleFork: false } },
  },
});
