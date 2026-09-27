import path from 'node:path';
import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.workspace-unit.config';

// Real MinIO and Temporal test-server coverage lives separately from the unit lane.
export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    include: [
      '../services/email-service/**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
      '../services/workflow-worker/**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
      '../sdk/**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
      '../ee/server/src/lib/**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    exclude: ['**/node_modules/**', '../**/node_modules/**', '**/dist/**', '../**/dist/**'],
    // Download the Temporal time-skipping test server before any test clock
    // starts, so a slow fetch is not charged to the workflow-worker test's
    // 120s budget.
    globalSetup: [
      ...[unitConfig.test?.globalSetup ?? []].flat(),
      path.resolve(__dirname, '../ee/temporal-workflows/src/test-utils/time-skipping-server.global-setup.ts'),
    ],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
