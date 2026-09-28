import path from 'node:path';
import { defineConfig } from 'vitest/config';
import repoConfig from '../../vitest.config';

// This package has no config of its own to find, so `npm test` here (and Nx's
// workflow-worker:test) runs under the repo-root config and also collects the
// Temporal integration test. Provision the time-skipping test server before any
// test clock starts, as server/vitest.workspace-runtime.config.ts does, so a
// slow download is never charged to that test.
export default defineConfig({
  ...repoConfig,
  test: {
    ...repoConfig.test,
    globalSetup: [
      ...[repoConfig.test?.globalSetup ?? []].flat(),
      path.resolve(__dirname, '../../ee/temporal-workflows/src/test-utils/time-skipping-server.global-setup.ts'),
    ],
  },
});
