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
    // repoConfig.test.projects is server/'s jsdom/node split, file lists globbed
    // against server/'s own directory. Spread here, its `extends: true` projects
    // re-resolve against this config's root instead, so this package's tests —
    // outside that glob — match neither project's exclude and run under BOTH,
    // including jsdom (breaks `new URL(..., import.meta.url)` since jsdom's
    // import.meta.url isn't a file: URL). No React tests live here, so drop the
    // inherited split; `node` stays the environment via repoConfig.test's default.
    projects: undefined,
    globalSetup: [
      ...[repoConfig.test?.globalSetup ?? []].flat(),
      path.resolve(__dirname, '../../ee/temporal-workflows/src/test-utils/time-skipping-server.global-setup.ts'),
    ],
  },
});
