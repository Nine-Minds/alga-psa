import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import type { WorkflowBundleV1 } from '@shared/workflow/bundle/workflowBundleV1';
import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';
import { validateWorkflowBundleHeaderV1 } from './validateWorkflowBundleHeaderV1';
import { validateWorkflowBundleSchemaV1 } from './validateWorkflowBundleSchemaV1';
import { validateWorkflowBundleDependenciesV1 } from './validateWorkflowBundleDependenciesV1';
import { WorkflowBundleImportError } from './workflowBundleImportErrors';

export type WorkflowBundleImportOptionsV1 = {
  force?: boolean;
};

export type WorkflowBundleImportSummaryV1 = {
  createdWorkflows: Array<{ key: string; workflowId: string }>;
  deletedWorkflows: Array<{ key: string; workflowId: string }>;
  createdPublishedVersions: Array<{ key: string; workflowId: string; versions: number[] }>;
};

const rewriteWorkflowDefinitionId = (definition: Record<string, unknown>, workflowId: string): Record<string, unknown> => {
  return { ...definition, id: workflowId };
};

export const importWorkflowBundleV1 = async (
  knex: Knex,
  bundleJson: unknown,
  options: WorkflowBundleImportOptionsV1 = {}
): Promise<WorkflowBundleImportSummaryV1> => {
  validateWorkflowBundleHeaderV1(bundleJson);
  validateWorkflowBundleSchemaV1(bundleJson);

  const bundle = bundleJson as WorkflowBundleV1;
  validateWorkflowBundleDependenciesV1(bundle);

  const force = options.force === true;

  return knex.transaction(async (trx) => {
    const summary: WorkflowBundleImportSummaryV1 = {
      createdWorkflows: [],
      deletedWorkflows: [],
      createdPublishedVersions: []
    };

    for (const wf of bundle.workflows) {
      const existing = await trx('workflow_definitions')
        .select('workflow_id', 'key')
        .where({ key: wf.key })
        .first() as { workflow_id: string; key: string } | undefined;

      if (existing) {
        if (!force) {
          throw new WorkflowBundleImportError(
            'WORKFLOW_KEY_CONFLICT',
            `Workflow with key "${wf.key}" already exists. Re-run with force to overwrite.`,
            { status: 409, details: { workflowKey: wf.key, existingWorkflowId: existing.workflow_id } }
          );
        }
        await trx('workflow_definitions')
          .where({ workflow_id: existing.workflow_id })
          .del();
        summary.deletedWorkflows.push({ key: wf.key, workflowId: existing.workflow_id });
      }

      const workflowId = uuidv4();
      const draftDefinition = rewriteWorkflowDefinitionId(wf.draft.definition, workflowId);
      const publishedVersions = wf.publishedVersions
        .map((v) => ({
          version: v.version,
          definition: rewriteWorkflowDefinitionId(v.definition, workflowId),
          payloadSchemaJson: v.payloadSchemaJson
        }))
        .sort((a, b) => a.version - b.version);

      await WorkflowDefinitionModelV2.create(trx, {
        workflow_id: workflowId,
        key: wf.key,
        name: wf.metadata.name,
        description: wf.metadata.description,
        payload_schema_ref: wf.metadata.payloadSchemaRef,
        payload_schema_mode: wf.metadata.payloadSchemaMode,
        pinned_payload_schema_ref: wf.metadata.pinnedPayloadSchemaRef,
        trigger: wf.metadata.trigger,
        draft_definition: draftDefinition,
        draft_version: wf.draft.draftVersion,
        status: publishedVersions.length ? 'published' : 'draft',
        is_system: wf.metadata.isSystem,
        is_visible: wf.metadata.isVisible,
        is_paused: wf.metadata.isPaused,
        concurrency_limit: wf.metadata.concurrencyLimit,
        auto_pause_on_failure: wf.metadata.autoPauseOnFailure,
        failure_rate_threshold: wf.metadata.failureRateThreshold,
        failure_rate_min_runs: wf.metadata.failureRateMinRuns,
        retention_policy_override: wf.metadata.retentionPolicyOverride
      });

      summary.createdWorkflows.push({ key: wf.key, workflowId });

      if (publishedVersions.length) {
        const versionsCreated: number[] = [];
        for (const v of publishedVersions) {
          await WorkflowDefinitionVersionModelV2.create(trx, {
            workflow_id: workflowId,
            version: v.version,
            definition_json: v.definition,
            payload_schema_json: v.payloadSchemaJson ?? null,
            published_at: new Date().toISOString()
          });
          versionsCreated.push(v.version);
        }
        summary.createdPublishedVersions.push({ key: wf.key, workflowId, versions: versionsCreated });
      }
    }

    return summary;
  });
};

