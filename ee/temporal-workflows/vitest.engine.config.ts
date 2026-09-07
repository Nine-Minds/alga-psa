import base from './vitest.no-docker.config';

// Each suite creates and tears down its own ephemeral Temporal test server.
// Activity stubs isolate workflow orchestration from application databases.
export default {
  ...base,
  test: {
    ...base.test,
    include: [
      'src/workflows/__tests__/tenant-product-upgrade-workflow.test.ts',
      'src/workflows/__tests__/tenant-creation-appliance.test.ts',
      'src/workflows/__tests__/sla-ticket-workflow.test.ts',
    ],
    coverage: { provider: 'v8', enabled: false },
    fileParallelism: false,
    maxWorkers: 1,
  },
};
