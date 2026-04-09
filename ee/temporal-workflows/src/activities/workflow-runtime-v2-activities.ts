import { getAdminConnection } from '@alga-psa/db/admin.js';
import { WorkflowRuntimeV2 } from '@alga-psa/workflows/runtime';

export async function executeWorkflowRuntimeV2Run(input: {
  runId: string;
  executionKey: string;
}): Promise<void> {
  const knex = await getAdminConnection();
  const runtime = new WorkflowRuntimeV2();
  await runtime.executeRun(knex, input.runId, `temporal:${input.executionKey}`);
}
