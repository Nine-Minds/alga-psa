import type { Knex } from 'knex';
import { applyRedactions, enforceSnapshotSize, safeSerialize } from '../utils/redactionUtils';
import WorkflowRunModelV2, { type WorkflowRunRecord } from '../../persistence/workflowRunModelV2';
import WorkflowRunLogModelV2 from '../../persistence/workflowRunLogModelV2';

const LOG_CONTEXT_MAX_BYTES = 64 * 1024;

export type StartRunParams = {
  workflowId: string;
  version: number;
  payload: Record<string, unknown>;
  tenantId?: string | null;
  triggerEvent?: { name: string; payload: Record<string, unknown> };
  triggerType?: 'event' | 'schedule' | 'recurring' | null;
  triggerMetadata?: Record<string, unknown> | null;
  triggerFireKey?: string | null;
  eventType?: string | null;
  sourcePayloadSchemaRef?: string | null;
  triggerMappingApplied?: boolean;
  definitionHash?: string | null;
  runtimeSemanticsVersion?: string | null;
  parentRunId?: string | null;
  rootRunId?: string | null;
};

// Run-state projection writer for the Temporal-native runtime. Execution
// itself lives in the Temporal workflow interpreter and its activities
// (ee/temporal-workflows); this class only allocates run rows.
export class WorkflowRuntimeV2 {
  private async logRunEvent(
    knex: Knex,
    run: WorkflowRunRecord,
    entry: {
      level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
      message: string;
      stepId?: string | null;
      stepPath?: string | null;
      context?: Record<string, unknown> | null;
      correlationKey?: string | null;
      eventName?: string | null;
      source?: string | null;
      redactions?: string[];
    }
  ): Promise<void> {
    try {
      const redactions = entry.redactions ?? [];
      const sanitized = entry.context ? applyRedactions(safeSerialize(entry.context), redactions) : null;
      const sized = sanitized ? enforceSnapshotSize(sanitized, LOG_CONTEXT_MAX_BYTES) : null;

      await WorkflowRunLogModelV2.create(knex, {
        run_id: run.run_id,
        tenant: run.tenant ?? null,
        step_id: entry.stepId ?? null,
        step_path: entry.stepPath ?? null,
        level: entry.level,
        message: entry.message,
        context_json: sized ? (sized as Record<string, unknown>) : null,
        correlation_key: entry.correlationKey ?? null,
        event_name: entry.eventName ?? null,
        source: entry.source ?? null
      });
    } catch (error) {
      // Avoid breaking workflow execution on log failures.
      console.warn('[WorkflowRuntimeV2] Failed to write run log', error);
    }
  }

  async startRun(knex: Knex, params: StartRunParams): Promise<string> {
    const run = await WorkflowRunModelV2.create(knex, {
      workflow_id: params.workflowId,
      workflow_version: params.version,
      tenant: params.tenantId ?? null,
      status: 'RUNNING',
      node_path: 'root.steps[0]',
      input_json: params.payload,
      trigger_type: params.triggerType ?? null,
      trigger_metadata_json: params.triggerMetadata ?? null,
      trigger_fire_key: params.triggerFireKey ?? null,
      event_type: params.eventType ?? null,
      source_payload_schema_ref: params.sourcePayloadSchemaRef ?? null,
      trigger_mapping_applied: params.triggerMappingApplied ?? false,
      definition_hash: params.definitionHash ?? null,
      runtime_semantics_version: params.runtimeSemanticsVersion ?? null,
      engine: 'temporal',
      parent_run_id: params.parentRunId ?? null,
      root_run_id: params.rootRunId ?? null,
      resume_event_name: params.triggerEvent?.name ?? null,
      resume_event_payload: params.triggerEvent?.payload ?? null
    });

    await this.logRunEvent(knex, run, {
      level: 'INFO',
      message: 'Run started',
      context: {
        workflowId: params.workflowId,
        workflowVersion: params.version,
        payloadSizeBytes: jsonSize(params.payload),
        triggerType: params.triggerType ?? null,
        triggerMetadata: params.triggerMetadata ?? null,
        triggerFireKey: params.triggerFireKey ?? null,
        triggerEventName: params.triggerEvent?.name ?? null,
        eventType: params.eventType ?? null,
        sourcePayloadSchemaRef: params.sourcePayloadSchemaRef ?? null,
        triggerMappingApplied: params.triggerMappingApplied ?? false
      },
      source: 'runtime'
    });

    return run.run_id;
  }
}

function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return 0;
  }
}
