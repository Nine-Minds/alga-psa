import base from './vitest.no-docker.config';

// Each suite creates and tears down its own ephemeral Temporal test server.
// Activity stubs isolate workflow orchestration from application databases.
export default {
  ...base,
  test: {
    ...base.test,
    include: [
      'src/__tests__/e2e/email-only.e2e.test.ts',
      'src/workflows/__tests__/production-index.engine.test.ts',
      'src/test-utils/test-connection.test.ts',
      'src/workflows/__tests__/generic-job-workflow.engine.test.ts',
      'src/workflows/__tests__/tenant-product-upgrade-workflow.test.ts',
      'src/workflows/__tests__/tenant-creation-appliance.test.ts',
      'src/workflows/__tests__/sla-ticket-workflow.test.ts',
      'src/workflows/__tests__/sla-ticket-workflow.integration.test.ts',
      'src/workflows/__tests__/managed-email-domain-workflow.test.ts',
      'src/workflows/portal-domains/__tests__/registration.workflow.integration.test.ts',
    ],
    coverage: { provider: 'v8', enabled: false },
    fileParallelism: false,
    maxWorkers: 1,
  },
};
