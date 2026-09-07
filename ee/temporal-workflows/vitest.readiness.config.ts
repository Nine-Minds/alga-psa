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
    ],
    coverage: { provider: 'v8', enabled: false },
    fileParallelism: false,
    maxWorkers: 1,
  },
});
