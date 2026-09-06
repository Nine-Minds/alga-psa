import { defineConfig } from 'vitest/config';
import path from 'node:path';
import serverConfig from './vitest.config';

// Service/SDK and colocated EE library suites were outside both the server
// unit filter and the package directory. Collect them in an explicit lane.
export default defineConfig({
  ...serverConfig,
  test: {
    ...serverConfig.test,
    include: [
      '../services/email-service/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../services/workflow-worker/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../sdk/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../ee/server/src/lib/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    exclude: [
      '**/node_modules/**', '../**/node_modules/**', '**/dist/**', '../**/dist/**',
      '../**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
      '../**/*.db.{test,spec}.?(c|m)[jt]s?(x)',
      '../**/*.playwright.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    coverage: { enabled: false },
  },
  resolve: {
    ...serverConfig.resolve,
    alias: [
      { find: '@alga/extension-runtime', replacement: path.resolve(__dirname, '../sdk/extension-runtime/src/index.ts') },
      { find: '@alga-psa/client-sdk', replacement: path.resolve(__dirname, '../sdk/alga-client-sdk/src/index.ts') },
      { find: '@alga-psa/extension-runtime', replacement: path.resolve(__dirname, '../sdk/extension-runtime/src/index.ts') },
      { find: '@alga-psa/extension-iframe-sdk', replacement: path.resolve(__dirname, '../sdk/extension-iframe-sdk/src/index.ts') },
      ...(serverConfig.resolve?.alias as Array<{ find: string | RegExp; replacement: string }>),
    ],
  },
});
