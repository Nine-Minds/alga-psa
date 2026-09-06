import { defineConfig } from 'vitest/config';
import serverConfig from './vitest.config';
import path from 'node:path';

// These suites are intentionally excluded from the DB-less coverage job.
// Give them their own runner instead of relying on package-local include lists.
export default defineConfig({
  ...serverConfig,
  test: {
    ...serverConfig.test,
    globalSetup: [
      path.resolve(__dirname, 'vitest.globalSetup.js'),
      path.resolve(__dirname, 'test-utils/workspaceDbGlobalSetup.ts'),
    ],
    include: [
      'migrations/__tests__/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/test/unit/**/*.db.test.?(c|m)[jt]s?(x)',
      '../packages/**/*.db.test.?(c|m)[jt]s?(x)',
      '../shared/**/*.db.test.?(c|m)[jt]s?(x)',
      '../ee/packages/**/*.db.test.?(c|m)[jt]s?(x)',
      '../ee/server/src/__tests__/unit/**/*.db.test.?(c|m)[jt]s?(x)',
    ],
    exclude: ['**/node_modules/**'],
    coverage: { enabled: false },
    // Existing DB harnesses recreate test_database. Each CI shard/job owns
    // its own service; files inside it must remain serial.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
