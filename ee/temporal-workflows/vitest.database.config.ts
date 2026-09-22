import base from './vitest.no-docker.config';

// CI supplies a migrated database; these suites create isolated tenant data.
export default {
  ...base,
  test: {
    ...base.test,
    include: ['src/__tests__/e2e/tenant-creation-workflow.e2e.test.ts', 'src/db/__tests__/database-connection.integration.test.ts', 'src/activities/__tests__/user-activities-simple.test.ts', 'src/activities/__tests__/tenant-activities.test.ts', 'src/db/__tests__/product-upgrade-operations.integration.test.ts', 'src/db/__tests__/tenant-setup-idempotency.integration.test.ts'],
    coverage: { provider: 'v8', enabled: false },
    fileParallelism: false,
    maxWorkers: 1,
  },
};
