import { getAdminConnection } from '@alga-psa/db/admin.js';
import { getFormValidationService } from '@shared/task-inbox';
import {
  WorkflowRuntimeV2,
  workflowDefinitionSchema,
  resolveInputMapping,
  resolveExpressionsWithSecrets,
  getActionRegistryV2,
  getNodeTypeRegistry,
  generateIdempotencyKey,
  initializeWorkflowRuntimeV2,
  createSecretResolverFromProvider,
  type Envelope,
  type InputMapping,
  type SecretResolver,
} from '@alga-psa/workflows/runtime';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime';
import { createHash } from 'crypto';
import {
  buildWorkflowRuntimeV2ExpressionContext,
  type WorkflowRuntimeV2ScopeState,
} from '../workflows/workflow-runtime-v2-interpreter.js';
import { createTenantSecretProvider } from '@alga-psa/shared/workflow/secrets';
import {
  WorkflowActionInvocationModelV2,
  WorkflowDefinitionVersionModelV2,
  WorkflowRunStepModelV2,
  WorkflowRunModelV2,
  WorkflowRunWaitModelV2,
  WorkflowTaskModel,
  WorkflowTaskStatus,
} from '@alga-psa/workflows/persistence';

export async function executeWorkflowRuntimeV2Run(input: {
  runId: string;
  executionKey: string;
}): Promise<void> {
  const knex = await getAdminConnection();
  initializeWorkflowRuntimeV2();
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
      meta: {
        ...(typeof run.source_payload_schema_ref === 'string'
          ? { sourcePayloadSchemaRef: run.source_payload_schema_ref }
          : {}),
        ...(typeof run.trigger_mapping_applied === 'boolean'
          ? { triggerMappingApplied: run.trigger_mapping_applied }
          : {}),
      },
      error: null,
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
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
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

export async function projectWorkflowRuntimeV2StepStart(input: {
  runId: string;
  stepPath: string;
  definitionStepId: string;
}): Promise<{ stepId: string }> {
  const knex = await getAdminConnection();
  const latest = await WorkflowRunStepModelV2.getLatestByRunAndPath(knex, input.runId, input.stepPath);
  const attempt = (latest?.attempt ?? 0) + 1;
  const step = await WorkflowRunStepModelV2.create(knex, {
    run_id: input.runId,
    step_path: input.stepPath,
    definition_step_id: input.definitionStepId,
    status: 'STARTED',
    attempt,
  });
  await WorkflowRunModelV2.update(knex, input.runId, {
    node_path: input.stepPath,
    status: 'RUNNING',
  });
  return {
    stepId: step.step_id,
  };
}

export async function projectWorkflowRuntimeV2StepCompletion(input: {
  runId: string;
  stepId: string;
  stepPath: string;
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  errorMessage?: string;
}): Promise<void> {
  const knex = await getAdminConnection();
  const now = new Date().toISOString();
  const step = await knex('workflow_run_steps')
    .where({ step_id: input.stepId })
    .first();
  const startedAt = step?.started_at ? new Date(step.started_at).getTime() : Date.now();
  const durationMs = Math.max(Date.now() - startedAt, 0);

  await WorkflowRunStepModelV2.update(knex, input.stepId, {
    status: input.status,
    duration_ms: durationMs,
    completed_at: now,
    error_json: input.status === 'FAILED' && input.errorMessage
      ? { message: input.errorMessage }
      : null,
  });

  await WorkflowRunModelV2.update(knex, input.runId, {
    status: input.status === 'FAILED'
      ? 'FAILED'
      : input.status === 'CANCELED'
        ? 'CANCELED'
        : 'RUNNING',
    error_json: input.status === 'FAILED' && input.errorMessage
      ? { message: input.errorMessage, nodePath: input.stepPath }
      : null,
  });
}

export async function projectWorkflowRuntimeV2TimeWaitStart(input: {
  runId: string;
  stepPath: string;
  dueAt: string;
  payload: {
    mode: 'duration' | 'until';
    durationMs: number | null;
    dueAt: string;
  };
}): Promise<{ waitId: string }> {
  const knex = await getAdminConnection();
  const wait = await WorkflowRunWaitModelV2.create(knex, {
    run_id: input.runId,
    step_path: input.stepPath,
    wait_type: 'time',
    timeout_at: input.dueAt,
    status: 'WAITING',
    payload: input.payload,
  });

  return {
    waitId: wait.wait_id,
  };
}

export async function projectWorkflowRuntimeV2TimeWaitResolved(input: {
  waitId: string;
  runId: string;
  status: 'RESOLVED' | 'CANCELED';
}): Promise<void> {
  const knex = await getAdminConnection();
  const now = new Date().toISOString();
  await WorkflowRunWaitModelV2.update(knex, input.waitId, {
    status: input.status,
    resolved_at: now,
  });
}

export async function projectWorkflowRuntimeV2EventWaitStart(input: {
  runId: string;
  stepPath: string;
  eventName: string;
  correlationKey: string | null;
  timeoutAt: string | null;
  payload: {
    eventName: string;
    correlationKey: string | null;
    filters: unknown[];
    timeoutAt: string | null;
  };
}): Promise<{ waitId: string }> {
  const knex = await getAdminConnection();
  const wait = await WorkflowRunWaitModelV2.create(knex, {
    run_id: input.runId,
    step_path: input.stepPath,
    wait_type: 'event',
    event_name: input.eventName,
    key: input.correlationKey,
    timeout_at: input.timeoutAt,
    status: 'WAITING',
    payload: input.payload,
  });

  return {
    waitId: wait.wait_id,
  };
}

export async function projectWorkflowRuntimeV2EventWaitResolved(input: {
  waitId: string;
  runId: string;
  status: 'RESOLVED' | 'CANCELED';
  matchedEventId?: string | null;
}): Promise<void> {
  const knex = await getAdminConnection();
  const now = new Date().toISOString();
  const existing = await knex('workflow_run_waits').where({ wait_id: input.waitId }).first(['payload']);
  const payload = isRecord(existing?.payload) ? existing.payload : {};
  await WorkflowRunWaitModelV2.update(knex, input.waitId, {
    status: input.status,
    resolved_at: now,
    payload: {
      ...payload,
      matchedEventId: input.matchedEventId ?? null,
      resolvedAt: now,
    },
  });
}

export async function startWorkflowRuntimeV2HumanTaskWait(input: {
  runId: string;
  stepPath: string;
  tenantId: string | null;
  taskType: string;
  title: string;
  description: string | null;
  contextData: Record<string, unknown>;
}): Promise<{
  waitId: string;
  taskId: string;
  eventName: string;
}> {
  const knex = await getAdminConnection();
  const taskId = await WorkflowTaskModel.createTask(knex, input.tenantId ?? '', {
    execution_id: input.runId,
    task_definition_type: 'system',
    system_task_definition_task_type: input.taskType,
    title: input.title,
    description: input.description ?? '',
    status: WorkflowTaskStatus.PENDING,
    priority: 'medium',
    context_data: input.contextData,
  } as never);

  const formSchema = await resolveTaskFormSchema(knex, input.tenantId, input.taskType);
  const wait = await WorkflowRunWaitModelV2.create(knex, {
    run_id: input.runId,
    step_path: input.stepPath,
    wait_type: 'human',
    key: taskId,
    event_name: 'HUMAN_TASK_COMPLETED',
    status: 'WAITING',
    payload: {
      taskId,
      contextData: input.contextData,
      formSchema,
      taskType: input.taskType,
    },
  });

  return {
    waitId: wait.wait_id,
    taskId,
    eventName: 'HUMAN_TASK_COMPLETED',
  };
}

export async function resolveWorkflowRuntimeV2HumanTaskWait(input: {
  waitId: string;
  runId: string;
  status: 'RESOLVED' | 'CANCELED';
  payload: Record<string, unknown>;
}): Promise<void> {
  const knex = await getAdminConnection();
  const now = new Date().toISOString();
  const existing = await knex('workflow_run_waits').where({ wait_id: input.waitId }).first(['payload']);
  const currentPayload = isRecord(existing?.payload) ? existing.payload : {};
  await WorkflowRunWaitModelV2.update(knex, input.waitId, {
    status: input.status,
    resolved_at: now,
    payload: {
      ...currentPayload,
      ...input.payload,
      resolvedAt: now,
    },
  });
}

export async function validateWorkflowRuntimeV2HumanTaskResponse(input: {
  tenantId: string | null;
  taskType: string;
  eventName: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const isAdminOverride = input.eventName === 'ADMIN_RESUME' || input.payload.__admin_override === true;
  if (isAdminOverride) {
    return;
  }

  const knex = await getAdminConnection();
  const formSchema = await resolveTaskFormSchema(knex, input.tenantId, input.taskType);
  if (!formSchema?.schema || !isRecord(formSchema.schema)) {
    throw {
      category: 'ValidationError',
      message: `Missing form schema for task type ${input.taskType}`,
      nodePath: 'human.task',
      at: new Date().toISOString(),
    };
  }

  const validation = getFormValidationService().validate(
    formSchema.schema as Record<string, unknown>,
    input.payload
  );
  if (!validation.valid) {
    throw {
      category: 'ValidationError',
      message: `Human task response validation failed: ${JSON.stringify(validation.errors ?? [])}`,
      nodePath: 'human.task',
      at: new Date().toISOString(),
    };
  }
}

export async function executeWorkflowRuntimeV2NodeStep(input: {
  runId: string;
  stepPath: string;
  stepId: string;
  tenantId: string | null;
  step: {
    type: string;
    config?: unknown;
  };
  scopes: WorkflowRuntimeV2ScopeState;
}): Promise<{ scopes: WorkflowRuntimeV2ScopeState }> {
  initializeWorkflowRuntimeV2();
  const knex = await getAdminConnection();
  const nodeRegistry = getNodeTypeRegistry();
  const nodeType = nodeRegistry.get(input.step.type);
  if (!nodeType) {
    throw new Error(`Unknown node type ${input.step.type}`);
  }

  const parsedConfig = nodeType.configSchema.parse(input.step.config ?? {});
  const env: Envelope = {
    v: 1,
    run: {
      id: input.scopes.system.runId,
      workflowId: input.scopes.system.workflowId,
      workflowVersion: input.scopes.system.workflowVersion,
      startedAt: new Date().toISOString(),
    },
    payload: input.scopes.payload,
    meta: (isRecord(input.scopes.meta) ? input.scopes.meta : {}) as Envelope['meta'],
    vars: input.scopes.workflow,
    error: input.scopes.error ? {
      name: typeof input.scopes.error.name === 'string' ? input.scopes.error.name : undefined,
      message: typeof input.scopes.error.message === 'string' ? input.scopes.error.message : String(input.scopes.error.message ?? ''),
      stack: typeof input.scopes.error.stack === 'string' ? input.scopes.error.stack : undefined,
      nodePath: typeof input.scopes.error.nodePath === 'string' ? input.scopes.error.nodePath : undefined,
      at: typeof input.scopes.error.at === 'string' ? input.scopes.error.at : new Date().toISOString(),
      data: input.scopes.error.data,
    } : undefined,
  };
  const secretResolver = buildWorkflowRuntimeV2SecretResolver(knex, input.tenantId);

  const result = await nodeType.handler(env, parsedConfig, {
    runId: input.runId,
    stepPath: input.stepPath,
    tenantId: input.tenantId,
    nowIso: () => new Date().toISOString(),
    secretResolver,
    actions: {
      call: async (actionId: string, version: number, args: unknown, options?: { idempotencyKey?: string; stepConfig?: unknown }) => {
        return executeActionInvocation({
          knex,
          runId: input.runId,
          stepPath: input.stepPath,
          tenantId: input.tenantId,
          actionId,
          version,
          args,
          expressionContext: buildWorkflowRuntimeV2ExpressionContext(input.scopes),
          stepConfig: options?.stepConfig,
          idempotencyKey: options?.idempotencyKey,
        });
      },
    },
    publishWait: async (wait) => {
      throw new Error(`Node step ${input.step.type} attempted to publish unsupported wait type ${wait.type}`);
    },
    resumeEvent: null,
    resumeError: null,
    knex,
  });

  if ('type' in result) {
    throw new Error(`Node step ${input.step.type} returned unsupported control result ${result.type}`);
  }

  return {
    scopes: {
      ...input.scopes,
      payload: isRecord(result.payload) ? result.payload : input.scopes.payload,
      workflow: isRecord(result.vars) ? result.vars : input.scopes.workflow,
      meta: isRecord(result.meta) ? result.meta : (isRecord(input.scopes.meta) ? input.scopes.meta : {}),
      error: result.error && typeof result.error === 'object'
        ? result.error as Record<string, unknown>
        : null,
    },
  };
}

export async function executeWorkflowRuntimeV2ActionStep(input: {
  runId: string;
  stepPath: string;
  stepId: string;
  tenantId: string | null;
  step: {
    type: 'action.call';
    config?: unknown;
  };
  scopes: WorkflowRuntimeV2ScopeState;
}): Promise<{ output: unknown; saveAsPath: string | null }> {
  initializeWorkflowRuntimeV2();
  const knex = await getAdminConnection();

  const config = parseActionCallConfig(input.step.config);
  if (!config.actionId || !config.version) {
    throw new Error('action.call config requires actionId and version');
  }

  const expressionContext = buildWorkflowRuntimeV2ExpressionContext(input.scopes);
  const secretResolver = buildWorkflowRuntimeV2SecretResolver(knex, input.tenantId);

  const resolvedInput = await resolveInputMapping(
    (config.inputMapping ?? {}) as InputMapping,
    {
      expressionContext,
      secretResolver,
      workflowRunId: input.runId,
    }
  ) ?? {};

  const explicitIdempotency = config.idempotencyKey
    ? await resolveExpressionsWithSecrets(config.idempotencyKey, expressionContext, secretResolver, input.runId)
    : null;
  const output = await executeActionInvocation({
    knex,
    runId: input.runId,
    stepPath: input.stepPath,
    tenantId: input.tenantId,
    actionId: config.actionId,
    version: config.version,
    args: resolvedInput,
    expressionContext,
    stepConfig: config,
    idempotencyKey: explicitIdempotency === null || explicitIdempotency === undefined
      ? undefined
      : String(explicitIdempotency),
  });

  return {
    output,
    saveAsPath: typeof config.saveAs === 'string' ? config.saveAs : null,
  };
}

export async function startWorkflowRuntimeV2ChildRun(input: {
  parentRunId: string;
  parentStepPath: string;
  tenantId: string | null;
  workflowId: string;
  workflowVersion: number;
  payload: Record<string, unknown>;
}): Promise<{
  childRunId: string;
  rootRunId: string;
  temporalWorkflowId: string;
}> {
  const knex = await getAdminConnection();
  const parentRun = await WorkflowRunModelV2.getById(knex, input.parentRunId);
  if (!parentRun) {
    throw new Error(`Parent workflow run not found: ${input.parentRunId}`);
  }

  const definitionVersion = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(
    knex,
    input.workflowId,
    input.workflowVersion
  );
  if (!definitionVersion) {
    throw new Error(`Child workflow definition not found: ${input.workflowId}@${input.workflowVersion}`);
  }
  const definitionHash = createHash('sha256')
    .update(JSON.stringify(definitionVersion.definition_json ?? null))
    .digest('hex');

  const runtime = new WorkflowRuntimeV2();
  const rootRunId = parentRun.root_run_id ?? parentRun.run_id;
  const childRunId = await runtime.startRun(knex, {
    workflowId: input.workflowId,
    version: input.workflowVersion,
    payload: input.payload,
    tenantId: input.tenantId ?? parentRun.tenant_id ?? null,
    triggerType: null,
    triggerMetadata: {
      parentRunId: parentRun.run_id,
      rootRunId,
      parentStepPath: input.parentStepPath,
    },
    definitionHash,
    runtimeSemanticsVersion: parentRun.runtime_semantics_version ?? null,
    engine: 'temporal',
    parentRunId: parentRun.run_id,
    rootRunId,
  });
  await WorkflowRunModelV2.update(knex, childRunId, {
    parent_run_id: parentRun.run_id,
    root_run_id: rootRunId,
  });

  return {
    childRunId,
    rootRunId,
    temporalWorkflowId: `workflow-runtime-v2:run:${childRunId}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function resolveTaskFormSchema(
  knex: Awaited<ReturnType<typeof getAdminConnection>>,
  tenantId: string | null,
  taskType: string
): Promise<{ formId: string; formType: string; schema: Record<string, unknown> | null } | null> {
  if (!taskType) return null;

  const systemTask = await knex('system_workflow_task_definitions')
    .where({ task_type: taskType })
    .first();
  if (systemTask) {
    const formId = systemTask.form_id as string;
    const formType = systemTask.form_type ?? 'system';
    if (formType === 'system') {
      const form = await knex('system_workflow_form_definitions')
        .where({ name: formId })
        .first();
      return {
        formId,
        formType,
        schema: isRecord(form?.json_schema) ? form.json_schema : null,
      };
    }
  }

  if (tenantId) {
    const tenantTask = await knex('workflow_task_definitions')
      .where({ tenant: tenantId, name: taskType })
      .first();
    if (tenantTask) {
      const formId = tenantTask.form_id as string;
      const formType = tenantTask.form_type ?? 'tenant';
      if (formType === 'tenant') {
        const formSchema = await knex('workflow_form_schemas')
          .where({ tenant: tenantId, form_id: formId })
          .first();
        return {
          formId,
          formType,
          schema: isRecord(formSchema?.json_schema) ? formSchema.json_schema : null,
        };
      }
    }
  }

  return null;
}

type ActionCallConfig = {
  actionId?: string;
  version?: number;
  inputMapping?: Record<string, unknown>;
  saveAs?: string;
  idempotencyKey?: { $expr?: string };
};

function parseActionCallConfig(config: unknown): ActionCallConfig {
  if (!isRecord(config)) {
    return {};
  }

  return {
    actionId: typeof config.actionId === 'string' ? config.actionId : undefined,
    version: typeof config.version === 'number' ? config.version : undefined,
    inputMapping: isRecord(config.inputMapping) ? config.inputMapping : undefined,
    saveAs: typeof config.saveAs === 'string' ? config.saveAs : undefined,
    idempotencyKey: isRecord(config.idempotencyKey) && typeof config.idempotencyKey.$expr === 'string'
      ? { $expr: config.idempotencyKey.$expr }
      : undefined,
  };
}

function buildWorkflowRuntimeV2SecretResolver(
  knex: Awaited<ReturnType<typeof getAdminConnection>>,
  tenantId: string | null
): SecretResolver {
  if (!tenantId) {
    return {
      async resolve(name: string): Promise<string> {
        throw new Error(`Cannot resolve tenant secret without tenant context: ${name}`);
      },
    };
  }

  const provider = createTenantSecretProvider(knex, tenantId);
  return createSecretResolverFromProvider((name, workflowRunId) => provider.getValue(name, workflowRunId));
}

async function executeActionInvocation(input: {
  knex: Awaited<ReturnType<typeof getAdminConnection>>;
  runId: string;
  stepPath: string;
  tenantId: string | null;
  actionId: string;
  version: number;
  args: unknown;
  expressionContext: Record<string, unknown>;
  stepConfig?: unknown;
  idempotencyKey?: string;
}): Promise<unknown> {
  const actionRegistry = getActionRegistryV2();
  const action = actionRegistry.get(input.actionId, input.version);
  if (!action) {
    throw new Error(`Unknown action ${input.actionId}@${input.version}`);
  }

  const parsedInput = action.inputSchema.parse(input.args);
  const rawKey = input.idempotencyKey ?? generateIdempotencyKey(
    input.runId,
    input.stepPath,
    input.actionId,
    input.version,
    parsedInput
  );
  const idempotencyKey = input.tenantId && !rawKey.startsWith(`${input.tenantId}:`)
    ? `${input.tenantId}:${rawKey}`
    : rawKey;

  const existing = await WorkflowActionInvocationModelV2.findByIdempotency(
    input.knex,
    input.actionId,
    input.version,
    idempotencyKey
  );
  if (existing?.status === 'SUCCEEDED') {
    return action.outputSchema.parse(existing.output_json ?? {});
  }

  const invocation = await WorkflowActionInvocationModelV2.create(input.knex, {
    run_id: input.runId,
    step_path: input.stepPath,
    action_id: input.actionId,
    action_version: input.version,
    idempotency_key: idempotencyKey,
    status: 'STARTED',
    attempt: 1,
    input_json: parsedInput as Record<string, unknown>,
    started_at: new Date().toISOString(),
  });

  try {
    const output = await action.handler(parsedInput, {
      runId: input.runId,
      stepPath: input.stepPath,
      stepConfig: input.stepConfig,
      expressionContext: input.expressionContext,
      tenantId: input.tenantId,
      idempotencyKey,
      attempt: invocation.attempt,
      nowIso: () => new Date().toISOString(),
      env: {},
      knex: input.knex,
    });
    const parsedOutput = action.outputSchema.parse(output);
    await WorkflowActionInvocationModelV2.update(input.knex, invocation.invocation_id, {
      status: 'SUCCEEDED',
      output_json: parsedOutput as Record<string, unknown>,
      completed_at: new Date().toISOString(),
    });
    return parsedOutput;
  } catch (error) {
    const runtimeError = normalizeActionRuntimeError(error, input.stepPath);
    await WorkflowActionInvocationModelV2.update(input.knex, invocation.invocation_id, {
      status: 'FAILED',
      error_message: runtimeError.message,
      completed_at: new Date().toISOString(),
    });
    throw runtimeError;
  }
}

type RuntimeErrorPayload = {
  category: string;
  code?: string;
  message: string;
  details?: unknown;
  nodePath: string;
  at: string;
};

function normalizeActionRuntimeError(error: unknown, stepPath: string): RuntimeErrorPayload {
  if (isRuntimeErrorPayload(error)) {
    return {
      ...error,
      nodePath: typeof error.nodePath === 'string' ? error.nodePath : stepPath,
      at: typeof error.at === 'string' ? error.at : new Date().toISOString(),
    };
  }

  return {
    category: 'ActionError',
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error
      ? {
          name: error.name,
          stack: error.stack,
        }
      : { raw: error },
    nodePath: stepPath,
    at: new Date().toISOString(),
  };
}

function isRuntimeErrorPayload(value: unknown): value is RuntimeErrorPayload {
  return value !== null
    && typeof value === 'object'
    && typeof (value as Record<string, unknown>).category === 'string'
    && typeof (value as Record<string, unknown>).message === 'string';
}
