import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// Fast behavior checks use activity/transport doubles and need no live Temporal
// environment. The remainder of the Temporal suite requires separate lanes.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      'src/config/__tests__/**/*.test.ts',
      'src/workflows/__tests__/generic-job-workflow.temporal.test.ts',
      'src/workflows/__tests__/workflow-runtime-v2-interpreter.test.ts',
      'src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts',
      'src/workflows/__tests__/workflow-runtime-v2-simulator-contract.test.ts',
      'src/activities/__tests__/workflow-runtime-v2-activities.test.ts',
      'src/activities/__tests__/sla-activities.test.ts',
      'src/activities/__tests__/marketing-activities.test.ts',
      'src/activities/__tests__/tenant-suspension-activities.test.ts',
      'src/activities/__tests__/tenant-email-ingestion-activities.test.ts',
      'src/db/__tests__/tenant-operations.email-settings.test.ts',
      'src/activities/__tests__/product-upgrade-activities.test.ts',
      'src/activities/__tests__/comment-recovery-forwarding.test.ts',
      'src/activities/__tests__/email-activities-simple.test.ts',
      'src/db/__tests__/product-bootstrap-resolver.test.ts',
      'src/schedules/__tests__/**/*.test.ts',
    ],
    coverage: { provider: 'v8', enabled: false },
    fileParallelism: false,
    maxWorkers: 1,
  },
});
