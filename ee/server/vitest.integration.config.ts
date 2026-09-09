import { defineConfig } from 'vitest/config';
import path from 'node:path';
import unitConfig from './vitest.unit.config';

// Integration files use the EE aliases and their own disposable migrated DB.
// Browser suites have a separate process/runtime and are never Vitest inputs.
export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    include: ['src/__tests__/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.playwright.{test,spec}.?(c|m)[jt]s?(x)'],
    globalSetup: [
      path.resolve(__dirname, '../../server/vitest.globalSetup.js'),
      path.resolve(__dirname, '../../server/test-utils/workspaceDbGlobalSetup.ts'),
      path.resolve(__dirname, './vitest.globalSetup.js'),
    ],
  },
});
