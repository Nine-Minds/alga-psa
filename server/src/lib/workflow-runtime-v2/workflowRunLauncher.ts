import type { Knex } from 'knex';

import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import type { WorkflowDefinitionVersionRecord } from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';
import WorkflowDefinitionVersionModelV2 from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';
import { WorkflowRuntimeV2, getSchemaRegistry } from '@shared/workflow/runtime';

export type WorkflowRunLaunchRequest = {
  workflowId: string;
  tenantId: string | null;
  payload: Record<string, unknown>;
  workflowVersion?: number | null;
  eventType?: string | null;
  sourcePayloadSchemaRef?: string | null;
  triggerMappingApplied?: boolean;
  execute?: boolean;
  executionKey?: string;
};

export type WorkflowRunLaunchResult = {
  runId: string;
  workflowVersion: number;
};

async function resolveVersionRecord(
  knex: Knex,
  workflowId: string,
  workflowVersion?: number | null
): Promise<WorkflowDefinitionVersionRecord | null> {
  if (workflowVersion) {
    return WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(knex, workflowId, workflowVersion);
  }
  const versions = await WorkflowDefinitionVersionModelV2.listByWorkflow(knex, workflowId);
  return versions[0] ?? null;
}

export async function launchPublishedWorkflowRun(
  knex: Knex,
  request: WorkflowRunLaunchRequest
): Promise<WorkflowRunLaunchResult> {
  const workflow = await WorkflowDefinitionModelV2.getById(knex, request.workflowId);
  if (!workflow) {
    throw new Error('Workflow not found');
  }
  if (workflow.is_paused) {
    throw new Error('Workflow is paused');
  }
  if (workflow.concurrency_limit) {
    const activeCount = await knex('workflow_runs')
      .where({ workflow_id: request.workflowId })
      .whereIn('status', ['RUNNING', 'WAITING'])
      .count('* as count')
      .first();
    const current = Number((activeCount as { count?: string | number } | undefined)?.count ?? 0);
    if (current >= workflow.concurrency_limit) {
      throw new Error('Workflow concurrency limit reached');
    }
  }

  const versionRecord = await resolveVersionRecord(knex, request.workflowId, request.workflowVersion);
  if (!versionRecord) {
    throw new Error('Workflow has no published versions');
  }

  const definition = versionRecord.definition_json as Record<string, unknown> | null;
  const schemaRefFromDefinition = definition?.payloadSchemaRef;
  const schemaRef =
    typeof schemaRefFromDefinition === 'string'
      ? schemaRefFromDefinition
      : (typeof workflow.payload_schema_ref === 'string' ? workflow.payload_schema_ref : null);

  const schemaRegistry = getSchemaRegistry();
  if (schemaRef && schemaRegistry.has(schemaRef)) {
    const validation = schemaRegistry.get(schemaRef).safeParse(request.payload);
    if (!validation.success) {
      throw new Error('Workflow payload failed validation');
    }
  }

  const runtime = new WorkflowRuntimeV2();
  const runId = await runtime.startRun(knex, {
    workflowId: request.workflowId,
    version: versionRecord.version,
    payload: request.payload,
    tenantId: request.tenantId,
    eventType: request.eventType ?? null,
    sourcePayloadSchemaRef: request.sourcePayloadSchemaRef ?? null,
    triggerMappingApplied: Boolean(request.triggerMappingApplied)
  });

  if (request.execute !== false) {
    await runtime.executeRun(
      knex,
      runId,
      request.executionKey ?? `launch-${request.workflowId}-${Date.now()}`
    );
  }

  return {
    runId,
    workflowVersion: versionRecord.version
  };
}
