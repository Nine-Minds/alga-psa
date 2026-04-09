import { getAdminConnection } from '@alga-psa/db/admin.js';
import { WorkflowRuntimeV2 } from '@alga-psa/workflows/runtime';
import { workflowDefinitionSchema } from '@alga-psa/workflows/runtime';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime';
import { createHash } from 'crypto';
import type { WorkflowRuntimeV2ScopeState } from '../workflows/workflow-runtime-v2-interpreter.js';

export async function executeWorkflowRuntimeV2Run(input: {
  runId: string;
  executionKey: string;
}): Promise<void> {
  const knex = await getAdminConnection();
  const runtime = new WorkflowRuntimeV2();
  await runtime.executeRun(knex, input.runId, `temporal:${input.executionKey}`);
}

export async function loadWorkflowRuntimeV2PinnedDefinition(input: {
  runId: string;
  workflowId: string;
  workflowVersion: number;
}): Promise<{ definition: WorkflowDefinition; initialScopes: WorkflowRuntimeV2ScopeState }> {
  const knex = await getAdminConnection();

  const run = await knex('workflow_runs')
    .where({ run_id: input.runId })
    .first();
  if (!run) {
    throw new Error(`Run ${input.runId} not found`);
  }

  const definitionRecord = await knex('workflow_definition_versions')
    .where({
      workflow_id: input.workflowId,
      version: input.workflowVersion,
    })
    .first();

  if (!definitionRecord) {
    throw new Error(`Workflow definition ${input.workflowId} v${input.workflowVersion} not found`);
  }

  const expectedDefinitionHash = typeof run.definition_hash === 'string' ? run.definition_hash : null;
  if (expectedDefinitionHash) {
    const actualDefinitionHash = createHash('sha256')
      .update(JSON.stringify(definitionRecord.definition_json ?? null))
      .digest('hex');
    if (actualDefinitionHash !== expectedDefinitionHash) {
      throw new Error(`Pinned workflow definition hash mismatch for ${input.workflowId} v${input.workflowVersion}`);
    }
  }

  return {
    definition: workflowDefinitionSchema.parse(definitionRecord.definition_json),
    initialScopes: {
      payload: isRecord(run.input_json) ? run.input_json : {},
      workflow: {},
      lexical: [],
      system: {
        runId: input.runId,
        workflowId: input.workflowId,
        workflowVersion: input.workflowVersion,
        tenantId: typeof run.tenant_id === 'string' ? run.tenant_id : null,
        definitionHash: typeof run.definition_hash === 'string' ? run.definition_hash : null,
        runtimeSemanticsVersion: typeof run.runtime_semantics_version === 'string'
          ? run.runtime_semantics_version
          : null,
      },
    },
  };
}

export async function completeWorkflowRuntimeV2Run(input: {
  runId: string;
  status: 'SUCCEEDED' | 'FAILED';
}): Promise<void> {
  const knex = await getAdminConnection();
  await knex('workflow_runs')
    .where({ run_id: input.runId })
    .update({
      status: input.status,
      node_path: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
