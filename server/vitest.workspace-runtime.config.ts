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
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
