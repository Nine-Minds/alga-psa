import type { Knex } from 'knex';
import { createHash } from 'crypto';

import {
  WorkflowDefinitionModelV2,
  WorkflowDefinitionVersionModelV2,
  WorkflowRunModelV2,
  type WorkflowDefinitionVersionRecord,
} from '@alga-psa/workflows/persistence';
import { WorkflowRuntimeV2, getSchemaRegistry } from '@alga-psa/workflows/runtime';
import { startWorkflowRuntimeV2TemporalRun } from './workflowRuntimeV2Temporal';
import { WORKFLOW_RUNTIME_V2_SEMANTICS_VERSION } from './workflowRuntimeV2Semantics';

const WORKFLOW_RUN_TRIGGER_FIRE_KEY_UNIQUE = 'workflow_runs_trigger_fire_key_unique';
const hashDefinition = (definition: unknown): string | null => {
  try {
    return createHash('sha256').update(JSON.stringify(definition ?? null)).digest('hex');
  } catch {
    return null;
  }
};

export type WorkflowRunLaunchRequest = {
  workflowId: string;
  tenantId: string | null;
  payload: Record<string, unknown>;
  workflowVersion?: number | null;
  triggerType?: 'event' | 'schedule' | 'recurring' | null;
  triggerMetadata?: Record<string, unknown> | null;
  triggerFireKey?: string | null;
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

type WorkflowRunLaunchFailureRequest = {
  workflowId: string;
  workflowVersion: number;
  tenantId: string | null;
  payload: Record<string, unknown>;
  triggerType?: 'event' | 'schedule' | 'recurring' | null;
  triggerMetadata?: Record<string, unknown> | null;
  triggerFireKey?: string | null;
  eventType?: string | null;
  sourcePayloadSchemaRef?: string | null;
  triggerMappingApplied?: boolean;
  definitionHash?: string | null;
  runtimeSemanticsVersion?: string | null;
  message: string;
  details?: unknown;
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

const isTriggerFireKeyDuplicateError = (error: unknown): boolean => {
  const candidate = error as { code?: string; constraint?: string } | null;
  return candidate?.code === '23505' && candidate?.constraint === WORKFLOW_RUN_TRIGGER_FIRE_KEY_UNIQUE;
};

export async function recordFailedWorkflowRunLaunch(
  knex: Knex,
  request: WorkflowRunLaunchFailureRequest
): Promise<WorkflowRunLaunchResult> {
  if (request.triggerFireKey) {
    const existingRun = await WorkflowRunModelV2.getByTriggerFireKey(knex, request.triggerFireKey);
    if (existingRun) {
      return {
        runId: existingRun.run_id,
        workflowVersion: existingRun.workflow_version
      };
    }
  }

  const now = new Date().toISOString();
  const run = await WorkflowRunModelV2.create(knex, {
    workflow_id: request.workflowId,
    workflow_version: request.workflowVersion,
    tenant_id: request.tenantId,
    status: 'FAILED',
    node_path: null,
    input_json: request.payload,
    trigger_type: request.triggerType ?? null,
    trigger_metadata_json: request.triggerMetadata ?? null,
    trigger_fire_key: request.triggerFireKey ?? null,
    event_type: request.eventType ?? null,
    source_payload_schema_ref: request.sourcePayloadSchemaRef ?? null,
    trigger_mapping_applied: request.triggerMappingApplied ?? false,
    definition_hash: request.definitionHash ?? null,
    runtime_semantics_version: request.runtimeSemanticsVersion ?? null,
    error_json: {
      message: request.message,
      stage: 'launch',
      ...(request.details !== undefined ? { details: request.details } : {})
    },
    started_at: now,
    completed_at: now
  });

  return {
    runId: run.run_id,
    workflowVersion: run.workflow_version
  };
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
  const definitionHash = hashDefinition(definition);
  const schemaRefFromDefinition = definition?.payloadSchemaRef;
  const schemaRef =
    typeof schemaRefFromDefinition === 'string'
      ? schemaRefFromDefinition
      : (typeof workflow.payload_schema_ref === 'string' ? workflow.payload_schema_ref : null);

  const schemaRegistry = getSchemaRegistry();
  if (schemaRef && schemaRegistry.has(schemaRef)) {
    const validation = schemaRegistry.get(schemaRef).safeParse(request.payload);
    if (!validation.success) {
      await recordFailedWorkflowRunLaunch(knex, {
        workflowId: request.workflowId,
        workflowVersion: versionRecord.version,
        tenantId: request.tenantId,
        payload: request.payload,
        triggerType: request.triggerType ?? null,
        triggerMetadata: request.triggerMetadata ?? null,
        triggerFireKey: request.triggerFireKey ?? null,
        eventType: request.eventType ?? null,
        sourcePayloadSchemaRef: request.sourcePayloadSchemaRef ?? null,
        triggerMappingApplied: request.triggerMappingApplied,
        definitionHash,
        runtimeSemanticsVersion: WORKFLOW_RUNTIME_V2_SEMANTICS_VERSION,
        message: 'Workflow payload failed validation',
        details: {
          issues: validation.error.issues
        }
      });
      throw new Error('Workflow payload failed validation');
    }
  }

  if (request.triggerFireKey) {
    const existingRun = await WorkflowRunModelV2.getByTriggerFireKey(knex, request.triggerFireKey);
    if (existingRun) {
      return {
        runId: existingRun.run_id,
        workflowVersion: existingRun.workflow_version
      };
    }
  }

  const runtime = new WorkflowRuntimeV2();
  let runId: string;

  try {
    runId = await runtime.startRun(knex, {
      workflowId: request.workflowId,
      version: versionRecord.version,
      payload: request.payload,
      tenantId: request.tenantId,
      triggerType: request.triggerType ?? null,
      triggerMetadata: request.triggerMetadata ?? null,
      triggerFireKey: request.triggerFireKey ?? null,
      eventType: request.eventType ?? null,
      sourcePayloadSchemaRef: request.sourcePayloadSchemaRef ?? null,
      triggerMappingApplied: Boolean(request.triggerMappingApplied),
      definitionHash,
      runtimeSemanticsVersion: WORKFLOW_RUNTIME_V2_SEMANTICS_VERSION,
      engine: 'temporal'
    });
  } catch (error) {
    if (!request.triggerFireKey || !isTriggerFireKeyDuplicateError(error)) {
      throw error;
    }

    const existingRun = await WorkflowRunModelV2.getByTriggerFireKey(knex, request.triggerFireKey);
    if (!existingRun) {
      throw error;
    }

    return {
      runId: existingRun.run_id,
      workflowVersion: existingRun.workflow_version
    };
  }

  if (request.execute !== false) {
    const executionKey = request.executionKey ?? `launch-${request.workflowId}-${Date.now()}`;
    const engine = String(process.env.WORKFLOW_RUNTIME_V2_ENGINE ?? 'temporal').trim().toLowerCase();
    const shouldUseTemporal = engine !== 'legacy';

    if (!shouldUseTemporal) {
      await runtime.executeRun(knex, runId, executionKey);
    } else {
      const allowLegacyFallback = process.env.NODE_ENV === 'test'
        || String(process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_FALLBACK ?? '').trim().toLowerCase() === 'true';

      try {
        const temporalStart = await startWorkflowRuntimeV2TemporalRun({
          runId,
          tenantId: request.tenantId ?? null,
          workflowId: request.workflowId,
          workflowVersion: versionRecord.version,
          triggerType: request.triggerType ?? null,
          executionKey,
        });
        await WorkflowRunModelV2.update(knex, runId, {
          engine: 'temporal',
          temporal_workflow_id: temporalStart.workflowId,
          temporal_run_id: temporalStart.firstExecutionRunId,
        });
      } catch (error) {
        if (!allowLegacyFallback) {
          throw error;
        }
        await WorkflowRunModelV2.update(knex, runId, {
          engine: 'db',
          temporal_workflow_id: null,
          temporal_run_id: null,
        });
        await runtime.executeRun(knex, runId, executionKey);
      }
    }
  }

  return {
    runId,
    workflowVersion: versionRecord.version
  };
}
