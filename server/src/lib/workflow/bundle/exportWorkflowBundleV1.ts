import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';
import {
  assertWorkflowBundleWorkflowKey,
  createWorkflowBundleHeaderV1,
  type WorkflowBundleV1,
  type WorkflowBundleWorkflowV1
} from '@shared/workflow/bundle/workflowBundleV1';
import type { Knex } from 'knex';

const normalizeBoolean = (value: unknown, defaultValue: boolean): boolean =>
  typeof value === 'boolean' ? value : defaultValue;

export const exportWorkflowBundleV1ForWorkflowId = async (knex: Knex, workflowId: string): Promise<WorkflowBundleV1> => {
  const record = await WorkflowDefinitionModelV2.getById(knex, workflowId);
  if (!record) {
    const error = new Error('Not found') as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  const key = record.key;
  assertWorkflowBundleWorkflowKey(key);

  const versions = await WorkflowDefinitionVersionModelV2.listByWorkflow(knex, workflowId);
  const publishedVersions = versions
    .map((row) => ({
      version: row.version,
      definition: row.definition_json,
      payloadSchemaJson: row.payload_schema_json ?? null
    }))
    .sort((a, b) => a.version - b.version);

  const workflow: WorkflowBundleWorkflowV1 = {
    key,
    metadata: {
      name: record.name,
      description: record.description ?? null,
      payloadSchemaRef: record.payload_schema_ref,
      payloadSchemaMode: record.payload_schema_mode ?? null,
      pinnedPayloadSchemaRef: record.pinned_payload_schema_ref ?? null,
      trigger: (record.trigger as any) ?? null,

      isSystem: normalizeBoolean(record.is_system, false),
      isVisible: normalizeBoolean(record.is_visible, true),
      isPaused: normalizeBoolean(record.is_paused, false),
      concurrencyLimit: record.concurrency_limit ?? null,
      autoPauseOnFailure: normalizeBoolean(record.auto_pause_on_failure, false),
      failureRateThreshold: (record.failure_rate_threshold as any) ?? null,
      failureRateMinRuns: record.failure_rate_min_runs ?? null,
      retentionPolicyOverride: (record.retention_policy_override as any) ?? null
    },
    draft: {
      draftVersion: record.draft_version,
      definition: record.draft_definition
    },
    publishedVersions
  };

  return {
    ...createWorkflowBundleHeaderV1(),
    workflows: [workflow]
  };
};
