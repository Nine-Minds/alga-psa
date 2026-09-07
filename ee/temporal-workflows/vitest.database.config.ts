import base from './vitest.no-docker.config';

// CI supplies a migrated database; these suites create isolated tenant data.
export default {
  ...base,
  test: {
    ...base.test,
    include: ['src/activities/__tests__/tenant-activities.test.ts', 'src/db/__tests__/product-upgrade-operations.integration.test.ts', 'src/db/__tests__/tenant-setup-idempotency.integration.test.ts'],
    coverage: { provider: 'v8', enabled: false },
    fileParallelism: false,
    maxWorkers: 1,
  },
};
