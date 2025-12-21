'use server';

import { zodToJsonSchema } from 'zod-to-json-schema';
import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import {
  WorkflowRuntimeV2,
  getActionRegistryV2,
  getNodeTypeRegistry,
  getSchemaRegistry,
  initializeWorkflowRuntimeV2,
  validateWorkflowDefinition
} from '@shared/workflow/runtime';
import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';
import WorkflowRunStepModelV2 from '@shared/workflow/persistence/workflowRunStepModelV2';
import WorkflowRunSnapshotModelV2 from '@shared/workflow/persistence/workflowRunSnapshotModelV2';
import WorkflowRunWaitModelV2 from '@shared/workflow/persistence/workflowRunWaitModelV2';
import WorkflowRuntimeEventModelV2 from '@shared/workflow/persistence/workflowRuntimeEventModelV2';
import {
  CreateWorkflowDefinitionInput,
  GetWorkflowDefinitionVersionInput,
  PublishWorkflowDefinitionInput,
  RunIdInput,
  SchemaRefInput,
  StartWorkflowRunInput,
  SubmitWorkflowEventInput,
  UpdateWorkflowDefinitionInput
} from './workflow-runtime-v2-schemas';

const throwHttpError = (status: number, message: string, details?: unknown): never => {
  const error = new Error(message) as Error & { status?: number; details?: unknown };
  error.status = status;
  if (details) {
    error.details = details;
  }
  throw error;
};

const requireUser = async () => {
  const user = await getCurrentUser();
  if (!user) {
    throwHttpError(401, 'Unauthorized');
  }
  return user;
};

export async function listWorkflowDefinitionsAction() {
  await requireUser();
  const { knex } = await createTenantKnex();
  return WorkflowDefinitionModelV2.list(knex);
}

export async function createWorkflowDefinitionAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = CreateWorkflowDefinitionInput.parse(input);

  const { knex } = await createTenantKnex();
  const workflowId = uuidv4();
  const definition = { ...parsed.definition, id: workflowId };

  const record = await WorkflowDefinitionModelV2.create(knex, {
    workflow_id: workflowId,
    name: definition.name,
    description: definition.description ?? null,
    payload_schema_ref: definition.payloadSchemaRef,
    trigger: definition.trigger ?? null,
    draft_definition: definition,
    draft_version: definition.version,
    status: 'draft',
    created_by: user.user_id,
    updated_by: user.user_id
  });

  return { workflowId: record.workflow_id };
}

export async function getWorkflowDefinitionVersionAction(input: unknown) {
  await requireUser();
  const parsed = GetWorkflowDefinitionVersionInput.parse(input);
  const { knex } = await createTenantKnex();
  const record = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(
    knex,
    parsed.workflowId,
    parsed.version
  );
  if (!record) {
    throwHttpError(404, 'Not found');
  }
  return record;
}

export async function updateWorkflowDefinitionDraftAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = UpdateWorkflowDefinitionInput.parse(input);

  const { knex } = await createTenantKnex();
  const definition = { ...parsed.definition, id: parsed.workflowId };

  const updated = await WorkflowDefinitionModelV2.update(knex, parsed.workflowId, {
    draft_definition: definition,
    draft_version: definition.version,
    updated_by: user.user_id,
    name: definition.name,
    description: definition.description ?? null,
    payload_schema_ref: definition.payloadSchemaRef,
    trigger: definition.trigger ?? null
  });

  if (!updated) {
    throwHttpError(404, 'Not found');
  }

  return updated;
}

export async function publishWorkflowDefinitionAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = PublishWorkflowDefinitionInput.parse(input);

  const { knex } = await createTenantKnex();
  const workflow = await WorkflowDefinitionModelV2.getById(knex, parsed.workflowId);
  if (!workflow) {
    throwHttpError(404, 'Not found');
  }

  const definition = { ...(parsed.definition as any ?? workflow.draft_definition), id: parsed.workflowId };
  if (!definition) {
    throwHttpError(400, 'No definition to publish');
  }

  const schemaRegistry = getSchemaRegistry();
  if (!schemaRegistry.has(definition.payloadSchemaRef)) {
    return {
      ok: false,
      errors: [
        {
          severity: 'error',
          stepPath: 'root',
          code: 'UNKNOWN_SCHEMA',
          message: `Unknown schema ref ${definition.payloadSchemaRef}`
        }
      ]
    };
  }

  const payloadSchemaJson = schemaRegistry.toJsonSchema(definition.payloadSchemaRef);
  const validation = validateWorkflowDefinition(definition, payloadSchemaJson as Record<string, unknown>);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings };
  }

  const record = await WorkflowDefinitionVersionModelV2.create(knex, {
    workflow_id: parsed.workflowId,
    version: parsed.version,
    definition_json: definition,
    payload_schema_json: payloadSchemaJson as Record<string, unknown>,
    published_by: user.user_id,
    published_at: new Date().toISOString()
  });

  await WorkflowDefinitionModelV2.update(knex, parsed.workflowId, {
    status: 'published',
    updated_by: user.user_id
  });

  return { ok: true, publishedVersion: record.version, errors: [], warnings: validation.warnings };
}

export async function startWorkflowRunAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = StartWorkflowRunInput.parse(input);

  const { knex, tenant } = await createTenantKnex();
  const runtime = new WorkflowRuntimeV2();

  const runId = await runtime.startRun(knex, {
    workflowId: parsed.workflowId,
    version: parsed.workflowVersion,
    payload: parsed.payload,
    tenantId: tenant
  });

  await runtime.executeRun(knex, runId, `action-${user.user_id}`);

  const run = await WorkflowRunModelV2.getById(knex, runId);
  return { runId, status: run?.status };
}

export async function getWorkflowRunAction(input: unknown) {
  await requireUser();
  const parsed = RunIdInput.parse(input);
  const { knex } = await createTenantKnex();
  const run = await WorkflowRunModelV2.getById(knex, parsed.runId);
  if (!run) {
    throwHttpError(404, 'Not found');
  }
  return run;
}

export async function listWorkflowRunStepsAction(input: unknown) {
  await requireUser();
  const parsed = RunIdInput.parse(input);
  const { knex } = await createTenantKnex();
  const steps = await WorkflowRunStepModelV2.listByRun(knex, parsed.runId);
  const snapshots = await WorkflowRunSnapshotModelV2.listByRun(knex, parsed.runId);
  return { steps, snapshots };
}

export async function cancelWorkflowRunAction(input: unknown) {
  await requireUser();
  const parsed = RunIdInput.parse(input);
  const { knex } = await createTenantKnex();

  await WorkflowRunModelV2.update(knex, parsed.runId, {
    status: 'CANCELED',
    node_path: null,
    completed_at: new Date().toISOString()
  });

  const waits = await knex('workflow_run_waits').where({ run_id: parsed.runId, status: 'WAITING' });
  for (const wait of waits) {
    await WorkflowRunWaitModelV2.update(knex, wait.wait_id, {
      status: 'CANCELED',
      resolved_at: new Date().toISOString()
    });
  }

  return { ok: true };
}

export async function resumeWorkflowRunAction(input: unknown) {
  const user = await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = RunIdInput.parse(input);
  const { knex } = await createTenantKnex();

  await WorkflowRunModelV2.update(knex, parsed.runId, { status: 'RUNNING' });

  const runtime = new WorkflowRuntimeV2();
  await runtime.executeRun(knex, parsed.runId, `admin-${user.user_id}`);

  return { ok: true };
}

export async function listWorkflowRegistryNodesAction() {
  await requireUser();
  initializeWorkflowRuntimeV2();
  const registry = getNodeTypeRegistry();
  return registry.list().map((node) => ({
    id: node.id,
    ui: node.ui,
    configSchema: zodToJsonSchema(node.configSchema, { name: node.id }),
    examples: node.examples ?? null,
    defaultRetry: node.defaultRetry ?? null
  }));
}

export async function listWorkflowRegistryActionsAction() {
  await requireUser();
  initializeWorkflowRuntimeV2();
  const registry = getActionRegistryV2();
  return registry.list().map((action) => ({
    id: action.id,
    version: action.version,
    sideEffectful: action.sideEffectful,
    retryHint: action.retryHint ?? null,
    idempotency: action.idempotency,
    ui: action.ui,
    inputSchema: zodToJsonSchema(action.inputSchema, { name: `${action.id}@${action.version}.input` }),
    outputSchema: zodToJsonSchema(action.outputSchema, { name: `${action.id}@${action.version}.output` }),
    examples: action.examples ?? null
  }));
}

export async function getWorkflowSchemaAction(input: unknown) {
  await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = SchemaRefInput.parse(input);
  const registry = getSchemaRegistry();
  if (!registry.has(parsed.schemaRef)) {
    throwHttpError(404, 'Not found');
  }
  return { ref: parsed.schemaRef, schema: registry.toJsonSchema(parsed.schemaRef) };
}

export async function submitWorkflowEventAction(input: unknown) {
  await requireUser();
  initializeWorkflowRuntimeV2();
  const parsed = SubmitWorkflowEventInput.parse(input);

  const { knex, tenant } = await createTenantKnex();
  let runId: string | null = null;

  await knex.transaction(async (trx) => {
    await WorkflowRuntimeEventModelV2.create(trx, {
      tenant_id: tenant,
      event_name: parsed.eventName,
      correlation_key: parsed.correlationKey,
      payload: parsed.payload
    });

    const wait = await WorkflowRunWaitModelV2.findEventWait(trx, parsed.eventName, parsed.correlationKey);
    if (!wait) {
      return;
    }

    await WorkflowRunWaitModelV2.update(trx, wait.wait_id, {
      status: 'RESOLVED',
      resolved_at: new Date().toISOString()
    });

    await WorkflowRunModelV2.update(trx, wait.run_id, {
      status: 'RUNNING',
      resume_event_name: parsed.eventName,
      resume_event_payload: parsed.payload
    });

    runId = wait.run_id;
  });

  const runtime = new WorkflowRuntimeV2();
  if (runId) {
    await runtime.executeRun(knex, runId, `event-${Date.now()}`);
  }

  const triggered = await WorkflowDefinitionModelV2.list(knex);
  const matching = triggered.filter(
    (workflow) => workflow.trigger?.eventName === parsed.eventName && workflow.status === 'published'
  );

  const startedRuns: string[] = [];
  for (const workflow of matching) {
    const versions = await WorkflowDefinitionVersionModelV2.listByWorkflow(knex, workflow.workflow_id);
    const latest = versions[0];
    if (!latest) continue;
    const newRunId = await runtime.startRun(knex, {
      workflowId: workflow.workflow_id,
      version: latest.version,
      payload: parsed.payload,
      tenantId: tenant
    });
    startedRuns.push(newRunId);
    await runtime.executeRun(knex, newRunId, `event-${Date.now()}`);
  }

  return { status: runId ? 'resumed' : 'no_wait', runId, startedRuns };
}

export async function listWorkflowEventsAction() {
  await requireUser();
  const { knex } = await createTenantKnex();
  return WorkflowRuntimeEventModelV2.list(knex);
}
