import path from 'node:path';
import { defineConfig } from 'vitest/config';
import serverConfig from '../../../server/vitest.config';

// Opt-in runner for finishSetup.sharedDb.harness.ts (alga-2026-0002714). Not a CI lane.
// Run from server/: SHARED_DEV_DB_E2E=1 npx vitest run --config ../tools/smoke-sim/alga2714/vitest.sharedDb.config.ts
// Reuses the server config's aliases/setup but drops its unit-lane `projects` split so only the harness runs.
const base = serverConfig as any;
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    projects: undefined,
    include: [path.resolve(__dirname, 'finishSetup.sharedDb.harness.ts')],
  },
});
