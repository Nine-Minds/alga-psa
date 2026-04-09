import { getAdminConnection } from '@alga-psa/db/admin.js';
import {
  WorkflowRuntimeV2,
  workflowDefinitionSchema,
  resolveInputMapping,
  resolveExpressionsWithSecrets,
  getActionRegistryV2,
  generateIdempotencyKey,
  initializeWorkflowRuntimeV2,
  type InputMapping,
  type SecretResolver,
} from '@alga-psa/workflows/runtime';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime';
import { createHash } from 'crypto';
import type { WorkflowRuntimeV2ScopeState } from '../workflows/workflow-runtime-v2-interpreter.js';
import {
  WorkflowActionInvocationModelV2,
  WorkflowDefinitionVersionModelV2,
  WorkflowRunStepModelV2,
  WorkflowRunModelV2,
  WorkflowRunWaitModelV2,
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

  const expressionContext = {
    ...input.scopes.workflow,
    ...(input.scopes.lexical[input.scopes.lexical.length - 1] ?? {}),
    payload: input.scopes.payload,
    vars: input.scopes.workflow,
    local: input.scopes.lexical[input.scopes.lexical.length - 1] ?? {},
    system: input.scopes.system,
    meta: {
      runId: input.scopes.system.runId,
      workflowId: input.scopes.system.workflowId,
      workflowVersion: input.scopes.system.workflowVersion,
      tenantId: input.scopes.system.tenantId,
      definitionHash: input.scopes.system.definitionHash,
      runtimeSemanticsVersion: input.scopes.system.runtimeSemanticsVersion,
    },
  };

  const resolvedInput = await resolveInputMapping(
    (config.inputMapping ?? {}) as InputMapping,
    {
      expressionContext,
      secretResolver: noSecretResolver,
      workflowRunId: input.runId,
    }
  ) ?? {};

  const actionRegistry = getActionRegistryV2();
  const action = actionRegistry.get(config.actionId, config.version);
  if (!action) {
    throw new Error(`Unknown action ${config.actionId}@${config.version}`);
  }

  const parsedInput = action.inputSchema.parse(resolvedInput);
  const explicitIdempotency = config.idempotencyKey
    ? await resolveExpressionsWithSecrets(config.idempotencyKey, expressionContext, noSecretResolver, input.runId)
    : null;
  const rawKey = explicitIdempotency === null || explicitIdempotency === undefined
    ? generateIdempotencyKey(input.runId, input.stepPath, config.actionId, config.version, parsedInput)
    : String(explicitIdempotency);
  const idempotencyKey = input.tenantId && !rawKey.startsWith(`${input.tenantId}:`)
    ? `${input.tenantId}:${rawKey}`
    : rawKey;

  const existing = await WorkflowActionInvocationModelV2.findByIdempotency(
    knex,
    config.actionId,
    config.version,
    idempotencyKey
  );
  if (existing?.status === 'SUCCEEDED') {
    return {
      output: action.outputSchema.parse(existing.output_json ?? {}),
      saveAsPath: typeof config.saveAs === 'string' ? config.saveAs : null,
    };
  }

  const invocation = await WorkflowActionInvocationModelV2.create(knex, {
    run_id: input.runId,
    step_path: input.stepPath,
    action_id: config.actionId,
    action_version: config.version,
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
      stepConfig: config,
      expressionContext,
      tenantId: input.tenantId,
      idempotencyKey,
      attempt: invocation.attempt,
      nowIso: () => new Date().toISOString(),
      env: {},
      knex,
    });
    const parsedOutput = action.outputSchema.parse(output);
    await WorkflowActionInvocationModelV2.update(knex, invocation.invocation_id, {
      status: 'SUCCEEDED',
      output_json: parsedOutput as Record<string, unknown>,
      completed_at: new Date().toISOString(),
    });

    return {
      output: parsedOutput,
      saveAsPath: typeof config.saveAs === 'string' ? config.saveAs : null,
    };
  } catch (error) {
    const runtimeError = normalizeActionRuntimeError(error, input.stepPath);
    await WorkflowActionInvocationModelV2.update(knex, invocation.invocation_id, {
      status: 'FAILED',
      error_message: runtimeError.message,
      completed_at: new Date().toISOString(),
    });
    throw runtimeError;
  }
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

const noSecretResolver: SecretResolver = {
  async resolve(name: string): Promise<string> {
    throw new Error(`Secret resolution is not available in Temporal workflow runtime activity: ${name}`);
  },
};

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
