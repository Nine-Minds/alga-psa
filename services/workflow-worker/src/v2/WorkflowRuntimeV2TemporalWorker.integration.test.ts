import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE } from '@alga-psa/workflows/lib/workflowRuntimeV2TemporalContract';
import { WorkflowRuntimeV2TemporalWorker } from './WorkflowRuntimeV2TemporalWorker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ORIGINAL_ENV = { ...process.env };

describe('WorkflowRuntimeV2TemporalWorker integration', () => {
  let testEnv: TestWorkflowEnvironment | null = null;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    if (testEnv) {
      await testEnv.teardown();
      testEnv = null;
    }
  });

  it('executes authored runtime workflow tasks on workflow-runtime-v2 with workflow-worker as the poller', async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    const runId = `run-${Date.now()}`;

    process.env.TEMPORAL_ADDRESS = testEnv.address;
    process.env.TEMPORAL_NAMESPACE = testEnv.namespace;
    process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE = WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE;
    process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_WORKFLOWS_PATH = path.join(
      __dirname,
      'WorkflowRuntimeV2TemporalWorker.integration.workflows.mjs',
    );
    process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_ACTIVITIES_PATH = path.join(
      __dirname,
      'WorkflowRuntimeV2TemporalWorker.integration.activities.mjs',
    );

    const temporalWorker = new WorkflowRuntimeV2TemporalWorker('integration-runtime-worker');
    await temporalWorker.start();

    try {
      const result = await testEnv.client.workflow.execute('workflowRuntimeV2RunWorkflow', {
        args: [{ runId }],
        taskQueue: WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE,
        workflowId: `workflow-runtime-v2:run:${runId}`,
      });

      expect(result).toEqual({
        runId,
        status: 'completed-by-workflow-worker',
      });
    } finally {
      await temporalWorker.stop();
    }
  });
});
