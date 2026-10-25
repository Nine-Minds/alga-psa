import base from './vitest.no-docker.config';

// CI supplies a migrated database; these suites create isolated tenant data.
export default {
  ...base,
  test: {
    ...base.test,
    // The tenant-creation E2E starts a time-skipping server, so this lane pays
    // for the server download like the engine lane does. Fetch it here, where
    // the retry budget is the setup deadline rather than one test's timeout.
    globalSetup: ['./src/test-utils/time-skipping-server.global-setup.ts'],
    include: ['src/__tests__/e2e/tenant-creation-workflow.e2e.test.ts', 'src/db/__tests__/database-connection.integration.test.ts', 'src/activities/__tests__/user-activities-simple.test.ts', 'src/activities/__tests__/tenant-activities.test.ts', 'src/db/__tests__/product-upgrade-operations.integration.test.ts', 'src/db/__tests__/tenant-setup-idempotency.integration.test.ts'],
    coverage: { provider: 'v8', enabled: false },
    fileParallelism: false,
    maxWorkers: 1,
  },
};
