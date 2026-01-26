import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';
import {
  assertWorkflowBundleWorkflowKey,
  createWorkflowBundleHeaderV1,
  type WorkflowBundleV1,
  type WorkflowBundleWorkflowV1
} from '@shared/workflow/bundle/workflowBundleV1';
import {
  collectWorkflowDefinitionDependencySummaryV1,
  mergeDependencySummariesV1
} from '@shared/workflow/bundle/dependencySummaryV1';
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

  const dependencySummary = mergeDependencySummariesV1([
    collectWorkflowDefinitionDependencySummaryV1(record.draft_definition),
    ...publishedVersions.map((v) => collectWorkflowDefinitionDependencySummaryV1(v.definition))
  ]);
  const schemaRefs = new Set(dependencySummary.schemaRefs);
  if (record.pinned_payload_schema_ref) schemaRefs.add(record.pinned_payload_schema_ref);

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
    dependencies: {
      ...dependencySummary,
      schemaRefs: Array.from(schemaRefs).sort((a, b) => a.localeCompare(b))
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

export const exportWorkflowBundleV1ForWorkflowIds = async (knex: Knex, workflowIds: string[]): Promise<WorkflowBundleV1> => {
  const uniqueIds = Array.from(new Set(workflowIds.filter(Boolean)));
  if (!uniqueIds.length) {
    throw new Error('exportWorkflowBundleV1ForWorkflowIds requires at least one workflowId.');
  }

  const records = await knex('workflow_definitions')
    .select('*')
    .whereIn('workflow_id', uniqueIds);

  const foundIds = new Set(records.map((r: any) => r.workflow_id));
  const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
  if (missingIds.length) {
    const error = new Error(`Not found: ${missingIds.join(', ')}`) as Error & { status?: number; details?: unknown };
    error.status = 404;
    error.details = { missingWorkflowIds: missingIds };
    throw error;
  }

  const versionRows = await knex('workflow_definition_versions')
    .select('workflow_id', 'version', 'definition_json', 'payload_schema_json')
    .whereIn('workflow_id', uniqueIds);

  const versionsByWorkflowId = new Map<string, Array<{ version: number; definition_json: any; payload_schema_json: any }>>();
  for (const row of versionRows as any[]) {
    const list = versionsByWorkflowId.get(row.workflow_id) ?? [];
    list.push(row);
    versionsByWorkflowId.set(row.workflow_id, list);
  }

  const workflows: WorkflowBundleWorkflowV1[] = records.map((record: any) => {
    const key = record.key;
    assertWorkflowBundleWorkflowKey(key);

    const publishedVersions = (versionsByWorkflowId.get(record.workflow_id) ?? [])
      .map((row) => ({
        version: Number(row.version),
        definition: row.definition_json,
        payloadSchemaJson: row.payload_schema_json ?? null
      }))
      .sort((a, b) => a.version - b.version);

    const dependencySummary = mergeDependencySummariesV1([
      collectWorkflowDefinitionDependencySummaryV1(record.draft_definition),
      ...publishedVersions.map((v) => collectWorkflowDefinitionDependencySummaryV1(v.definition))
    ]);
    const schemaRefs = new Set(dependencySummary.schemaRefs);
    if (record.pinned_payload_schema_ref) schemaRefs.add(record.pinned_payload_schema_ref);

    return {
      key,
      metadata: {
        name: record.name,
        description: record.description ?? null,
        payloadSchemaRef: record.payload_schema_ref,
        payloadSchemaMode: record.payload_schema_mode ?? null,
        pinnedPayloadSchemaRef: record.pinned_payload_schema_ref ?? null,
        trigger: record.trigger ?? null,

        isSystem: normalizeBoolean(record.is_system, false),
        isVisible: normalizeBoolean(record.is_visible, true),
        isPaused: normalizeBoolean(record.is_paused, false),
        concurrencyLimit: record.concurrency_limit ?? null,
        autoPauseOnFailure: normalizeBoolean(record.auto_pause_on_failure, false),
        failureRateThreshold: record.failure_rate_threshold ?? null,
        failureRateMinRuns: record.failure_rate_min_runs ?? null,
        retentionPolicyOverride: record.retention_policy_override ?? null
      },
      dependencies: {
        ...dependencySummary,
        schemaRefs: Array.from(schemaRefs).sort((a, b) => a.localeCompare(b))
      },
      draft: {
        draftVersion: record.draft_version,
        definition: record.draft_definition
      },
      publishedVersions
    };
  });

  workflows.sort((a, b) => a.key.localeCompare(b.key));

  return {
    ...createWorkflowBundleHeaderV1(),
    workflows
  };
};
