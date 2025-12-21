import type { Knex } from 'knex';
import type {
  Envelope,
  WorkflowDefinition,
  WorkflowRunStatus,
  WorkflowErrorCategory,
  Step,
  RetryPolicy
} from '../types';
import {
  workflowDefinitionSchema,
  envelopeSchema
} from '../types';
import { getNodeTypeRegistry } from '../registries/nodeTypeRegistry';
import { getActionRegistryV2 } from '../registries/actionRegistry';
import { resolveExpressions } from '../utils/expressionResolver';
import { applyRedactions, enforceSnapshotSize, safeSerialize } from '../utils/redactionUtils';
import { applyAssignments } from '../utils/assignmentUtils';
import { parseNodePath } from '../utils/nodePathUtils';
import { scheduleRetryAt } from '../utils/retryUtils';
import { generateIdempotencyKey } from '../utils/idempotencyUtils';
import WorkflowDefinitionVersionModelV2 from '../../persistence/workflowDefinitionVersionModelV2';
import WorkflowRunModelV2 from '../../persistence/workflowRunModelV2';
import WorkflowRunStepModelV2 from '../../persistence/workflowRunStepModelV2';
import WorkflowRunWaitModelV2 from '../../persistence/workflowRunWaitModelV2';
import WorkflowActionInvocationModelV2 from '../../persistence/workflowActionInvocationModelV2';
import WorkflowRunSnapshotModelV2 from '../../persistence/workflowRunSnapshotModelV2';

const SNAPSHOT_MAX_BYTES = 256 * 1024;
const SNAPSHOT_RETENTION_DAYS = Number(process.env.WORKFLOW_SNAPSHOT_RETENTION_DAYS ?? '30');
const LEASE_MS = 30_000;

export type StartRunParams = {
  workflowId: string;
  version: number;
  payload: Record<string, unknown>;
  tenantId?: string | null;
  triggerEvent?: { name: string; payload: Record<string, unknown> };
};

export type EventResumePayload = {
  runId: string;
  eventName: string;
  payload: Record<string, unknown>;
};

export class WorkflowRuntimeV2 {
  async startRun(knex: Knex, params: StartRunParams): Promise<string> {
    const nodePath = params.payload ? 'root.steps[0]' : 'root.steps[0]';
    const run = await WorkflowRunModelV2.create(knex, {
      workflow_id: params.workflowId,
      workflow_version: params.version,
      tenant_id: params.tenantId ?? null,
      status: 'RUNNING',
      node_path: nodePath,
      input_json: params.payload,
      resume_event_name: params.triggerEvent?.name ?? null,
      resume_event_payload: params.triggerEvent?.payload ?? null
    });

    return run.run_id;
  }

  async acquireRunnableRun(knex: Knex, workerId: string): Promise<string | null> {
    const updated = await knex('workflow_runs')
      .where({ status: 'RUNNING' })
      .andWhere((builder) => {
        builder.whereNull('lease_expires_at').orWhere('lease_expires_at', '<=', knex.fn.now());
      })
      .orderBy('updated_at', 'asc')
      .first();

    if (!updated) return null;

    await knex('workflow_runs')
      .where({ run_id: updated.run_id })
      .update({
        lease_owner: workerId,
        lease_expires_at: new Date(Date.now() + LEASE_MS).toISOString(),
        updated_at: new Date().toISOString()
      });

    return updated.run_id as string;
  }

  async executeRun(knex: Knex, runId: string, workerId: string): Promise<void> {
    const run = await WorkflowRunModelV2.getById(knex, runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    if (run.lease_owner && run.lease_owner !== workerId) {
      return;
    }

    const definitionRecord = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(knex, run.workflow_id, run.workflow_version);
    if (!definitionRecord) {
      throw new Error(`Workflow definition ${run.workflow_id} v${run.workflow_version} not found`);
    }

    const definition = workflowDefinitionSchema.parse(definitionRecord.definition_json);

    let env = await this.loadEnvelope(knex, run, definition);
    let currentPath = run.node_path ?? null;

    if (!currentPath) {
      await this.markRunCompleted(knex, runId, 'SUCCEEDED');
      return;
    }

    while (currentPath) {
      const stepPath = currentPath;
      const { step, stack } = resolveStepAtPath(definition, stepPath);
      if (!step) {
        await this.markRunCompleted(knex, runId, 'SUCCEEDED');
        return;
      }

      const stepStart = Date.now();
      const attempt = await this.nextAttempt(knex, runId, stepPath);
      const stepRecord = await WorkflowRunStepModelV2.create(knex, {
        run_id: runId,
        step_path: stepPath,
        definition_step_id: step.id,
        status: 'STARTED',
        attempt
      });

      try {
        env = await this.prepareEnvForStep(env, definition, stepPath);

        const result = await this.executeStep(knex, run, definition, step, stepPath, env);

        if (result.type === 'wait') {
          await WorkflowRunStepModelV2.update(knex, stepRecord.step_id, {
            status: 'STARTED'
          });
          await WorkflowRunModelV2.update(knex, runId, {
            status: 'WAITING',
            resume_event_name: null,
            resume_event_payload: null,
            resume_error: null,
            lease_owner: null,
            lease_expires_at: null
          });
          return;
        }

        if (result.type === 'return') {
          env = result.env;
          const snapshotId = await this.persistSnapshot(knex, runId, stepPath, env);
          await WorkflowRunStepModelV2.update(knex, stepRecord.step_id, {
            status: 'SUCCEEDED',
            duration_ms: Date.now() - stepStart,
            completed_at: new Date().toISOString(),
            snapshot_id: snapshotId
          });
          await WorkflowRunModelV2.update(knex, runId, {
            status: 'SUCCEEDED',
            node_path: null,
            completed_at: new Date().toISOString(),
            error_json: null,
            resume_event_name: null,
            resume_event_payload: null,
            resume_error: null
          });
          return;
        }

        env = result.env;

        const snapshotId = await this.persistSnapshot(knex, runId, stepPath, env);
        await WorkflowRunStepModelV2.update(knex, stepRecord.step_id, {
          status: 'SUCCEEDED',
          duration_ms: Date.now() - stepStart,
          completed_at: new Date().toISOString(),
          snapshot_id: snapshotId
        });

        currentPath = result.nextPath;
        await WorkflowRunModelV2.update(knex, runId, {
          node_path: currentPath,
          status: currentPath ? 'RUNNING' : 'SUCCEEDED',
          resume_event_name: null,
          resume_event_payload: null,
          resume_error: null,
          error_json: null,
          completed_at: currentPath ? null : new Date().toISOString()
        });

        if (!currentPath) {
          return;
        }
      } catch (error) {
        const runtimeError = toRuntimeError(error, stepPath);
        const onErrorPolicy = getOnErrorPolicy(step);

        if (onErrorPolicy === 'continue') {
          env = applyErrorToEnv(env, runtimeError, stepPath);
          const snapshotId = await this.persistSnapshot(knex, runId, stepPath, env);
          await WorkflowRunStepModelV2.update(knex, stepRecord.step_id, {
            status: 'SUCCEEDED',
            duration_ms: Date.now() - stepStart,
            completed_at: new Date().toISOString(),
            error_json: runtimeError,
            snapshot_id: snapshotId
          });

          currentPath = findNextPath(definition, stepPath, env, stack);
          await WorkflowRunModelV2.update(knex, runId, {
            node_path: currentPath,
            status: currentPath ? 'RUNNING' : 'SUCCEEDED',
            resume_event_name: null,
            resume_event_payload: null,
            resume_error: null,
            error_json: null,
            completed_at: currentPath ? null : new Date().toISOString()
          });
          if (!currentPath) return;
          continue;
        }

        const forEachPolicy = resolveForEachOnItemError(definition, stepPath);
        if (forEachPolicy === 'continue') {
          env = applyErrorToEnv(env, runtimeError, stepPath);
          const snapshotId = await this.persistSnapshot(knex, runId, stepPath, env);
          await WorkflowRunStepModelV2.update(knex, stepRecord.step_id, {
            status: 'SUCCEEDED',
            duration_ms: Date.now() - stepStart,
            completed_at: new Date().toISOString(),
            error_json: runtimeError,
            snapshot_id: snapshotId
          });

          currentPath = findNextPath(definition, stepPath, env, stack);
          await WorkflowRunModelV2.update(knex, runId, {
            node_path: currentPath,
            status: currentPath ? 'RUNNING' : 'SUCCEEDED',
            resume_event_name: null,
            resume_event_payload: null,
            resume_error: null,
            error_json: null,
            completed_at: currentPath ? null : new Date().toISOString()
          });
          if (!currentPath) return;
          continue;
        }

        const retryPolicy = resolveRetryPolicy(step);
        if (retryPolicy && isRetryable(runtimeError, retryPolicy, attempt)) {
          const timeoutAt = scheduleRetryAt(retryPolicy, attempt);
          await WorkflowRunStepModelV2.update(knex, stepRecord.step_id, {
            status: 'RETRY_SCHEDULED',
            duration_ms: Date.now() - stepStart,
            completed_at: new Date().toISOString(),
            error_json: runtimeError
          });

          await WorkflowRunWaitModelV2.create(knex, {
            run_id: runId,
            step_path: stepPath,
            wait_type: 'retry',
            timeout_at: timeoutAt,
            status: 'WAITING'
          });

          await WorkflowRunModelV2.update(knex, runId, {
            status: 'WAITING',
            node_path: stepPath,
            error_json: runtimeError,
            lease_owner: null,
            lease_expires_at: null
          });
          return;
        }

        const catchPath = findCatchPath(definition, stepPath, stack, runtimeError, env);
        if (catchPath) {
          env = applyErrorToEnv(env, runtimeError, stepPath);
          await WorkflowRunStepModelV2.update(knex, stepRecord.step_id, {
            status: 'FAILED',
            duration_ms: Date.now() - stepStart,
            completed_at: new Date().toISOString(),
            error_json: runtimeError
          });

          currentPath = catchPath;
          await WorkflowRunModelV2.update(knex, runId, {
            node_path: currentPath,
            status: 'RUNNING',
            error_json: runtimeError
          });
          continue;
        }

        await WorkflowRunStepModelV2.update(knex, stepRecord.step_id, {
          status: 'FAILED',
          duration_ms: Date.now() - stepStart,
          completed_at: new Date().toISOString(),
          error_json: runtimeError
        });
        await WorkflowRunModelV2.update(knex, runId, {
          status: 'FAILED',
          node_path: null,
          error_json: runtimeError,
          completed_at: new Date().toISOString()
        });
        return;
      }
    }
  }

  async resumeRunFromEvent(knex: Knex, payload: EventResumePayload, workerId: string): Promise<void> {
    const run = await WorkflowRunModelV2.getById(knex, payload.runId);
    if (!run) throw new Error(`Run ${payload.runId} not found`);

    await WorkflowRunModelV2.update(knex, payload.runId, {
      resume_event_name: payload.eventName,
      resume_event_payload: payload.payload,
      status: 'RUNNING'
    });

    await this.executeRun(knex, payload.runId, workerId);
  }

  async resumeRunFromTimeout(knex: Knex, runId: string, workerId: string, message: string): Promise<void> {
    const run = await WorkflowRunModelV2.getById(knex, runId);
    if (!run) return;
    await WorkflowRunModelV2.update(knex, runId, {
      resume_error: {
        category: 'TimeoutError',
        message
      },
      status: 'RUNNING'
    });
    await this.executeRun(knex, runId, workerId);
  }

  private async loadEnvelope(knex: Knex, run: any, definition: WorkflowDefinition): Promise<Envelope> {
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(knex, run.run_id);
    if (snapshots.length > 0) {
      const last = snapshots[snapshots.length - 1];
      return envelopeSchema.parse(last.envelope_json);
    }

    const env: Envelope = {
      v: 1,
      run: {
        id: run.run_id,
        workflowId: run.workflow_id,
        workflowVersion: run.workflow_version,
        startedAt: typeof run.started_at === 'string'
          ? run.started_at
          : new Date(run.started_at ?? Date.now()).toISOString()
      },
      payload: run.input_json ?? {},
      meta: {},
      vars: {},
      error: undefined
    };

    return envelopeSchema.parse(env);
  }

  private async prepareEnvForStep(env: Envelope, definition: WorkflowDefinition, path: string): Promise<Envelope> {
    const forEachContext = findEnclosingForEach(definition, path, env);
    if (forEachContext) {
      const { itemVar, item } = forEachContext;
      if (itemVar) {
        env.vars[itemVar] = item;
      }
    }
    return env;
  }

  private async executeStep(
    knex: Knex,
    run: any,
    definition: WorkflowDefinition,
    step: Step,
    path: string,
    env: Envelope
  ): Promise<{ type: 'continue'; env: Envelope; nextPath: string | null } | { type: 'wait' } | { type: 'return'; env: Envelope } > {
    if (step.type === 'control.return') {
      return { type: 'return', env };
    }

    if (step.type === 'control.if') {
      const ifStep = step as Step & { type: 'control.if'; condition: any; then: Step[]; else?: Step[] };
      const ctx = this.expressionContext(env);
      const condition = await resolveExpressions(ifStep.condition, ctx);
      if (typeof condition !== 'boolean') {
        throw createRuntimeError('ExpressionError', 'control.if condition did not evaluate to boolean', path);
      }
      const branch = condition ? ifStep.then : (ifStep.else ?? []);
      const nextPath = branch.length > 0 ? `${path}.${condition ? 'then' : 'else'}.steps[0]` : findNextPath(definition, path, env, resolveStepAtPath(definition, path).stack);
      return { type: 'continue', env, nextPath };
    }

    if (step.type === 'control.forEach') {
      const forEachStep = step as Step & { type: 'control.forEach'; items: any; itemVar: string; body: Step[]; onItemError?: 'continue' | 'fail' };
      const ctx = this.expressionContext(env);
      const items = await resolveExpressions(forEachStep.items, ctx);
      if (!Array.isArray(items)) {
        throw createRuntimeError('ValidationError', 'control.forEach items did not evaluate to array', path);
      }
      const loopKey = forEachStep.id;
      const previous = env.vars[forEachStep.itemVar];
      env.vars.__forEach = {
        ...(env.vars.__forEach as Record<string, unknown> || {}),
        [loopKey]: {
          items,
          index: 0,
          itemVar: forEachStep.itemVar,
          previous
        }
      };

      if (items.length === 0 || forEachStep.body.length === 0) {
        env.vars[forEachStep.itemVar] = previous;
        return { type: 'continue', env, nextPath: findNextPath(definition, path, env, resolveStepAtPath(definition, path).stack) };
      }

      env.vars[forEachStep.itemVar] = items[0];
      return { type: 'continue', env, nextPath: `${path}.body.steps[0]` };
    }

    if (step.type === 'control.tryCatch') {
      const tryStep = step as Step & { type: 'control.tryCatch'; try: Step[]; catch: Step[]; captureErrorAs?: string };
      const nextPath = tryStep.try.length > 0 ? `${path}.try.steps[0]` : findNextPath(definition, path, env, resolveStepAtPath(definition, path).stack);
      return { type: 'continue', env, nextPath };
    }

    if (step.type === 'control.callWorkflow') {
      const callStep = step as Step & { type: 'control.callWorkflow'; workflowId: string; workflowVersion: number; inputMapping?: Record<string, { $expr: string }>; outputMapping?: Record<string, { $expr: string }> };
      // MVP: inline execution using same runtime (no waits allowed)
      const input = await resolveMapping(env, callStep.inputMapping);
      const childRunId = await this.startRun(knex, {
        workflowId: callStep.workflowId,
        version: callStep.workflowVersion,
        payload: input ?? {},
        tenantId: run.tenant_id
      });
      await this.executeRun(knex, childRunId, `inline-${run.run_id}`);
      const childRun = await WorkflowRunModelV2.getById(knex, childRunId);
      if (!childRun || childRun.status !== 'SUCCEEDED') {
        const message = childRun?.error_json?.message || `Child workflow ${callStep.workflowId}@${callStep.workflowVersion} failed`;
        throw createRuntimeError('ActionError', message, path);
      }
      if (callStep.outputMapping) {
        const snapshots = await WorkflowRunSnapshotModelV2.listByRun(knex, childRunId);
        const lastSnapshot = snapshots[snapshots.length - 1];
        const childEnv = lastSnapshot?.envelope_json ?? {};
        env.vars.childRun = childEnv;
        const mapped = await resolveMapping(env, callStep.outputMapping);
        if (mapped) {
          env = applyAssignments(env, mapped);
        }
        delete env.vars.childRun;
      }
      const nextPath = findNextPath(definition, path, env, resolveStepAtPath(definition, path).stack);
      return { type: 'continue', env, nextPath };
    }

    // Node step
    const nodeRegistry = getNodeTypeRegistry();
    const nodeType = nodeRegistry.get(step.type);
    if (!nodeType) {
      throw createRuntimeError('ValidationError', `Unknown node type ${step.type}`, path);
    }
    const nodeStep = step as Step & { config?: unknown };
    const config = nodeStep.config ?? {};
    const parsedConfig = nodeType.configSchema.parse(config);
    const nodeCtx = {
      runId: run.run_id,
      stepPath: path,
      tenantId: run.tenant_id,
      nowIso: () => new Date().toISOString(),
      actions: {
        call: async (actionId: string, version: number, args: any, options?: { idempotencyKey?: string }) => {
          const redactions = env.meta.redactions ?? [];
          return this.executeAction(knex, run.run_id, path, actionId, version, args, options?.idempotencyKey, run.tenant_id, redactions);
        }
      },
      publishWait: async (wait: { type: 'event' | 'human'; key?: string; eventName?: string; timeoutAt?: string; payload?: unknown }) => {
        await WorkflowRunWaitModelV2.create(knex, {
          run_id: run.run_id,
          step_path: path,
          wait_type: wait.type,
          key: wait.key ?? null,
          event_name: wait.eventName ?? null,
          timeout_at: wait.timeoutAt ?? null,
          status: 'WAITING',
          payload: wait.payload ?? null
        });
      },
      resumeEvent: run.resume_event_name ? { name: run.resume_event_name, payload: run.resume_event_payload } : null,
      resumeError: run.resume_error ?? null,
      knex
    };

    const handlerResult = await nodeType.handler(env, parsedConfig, nodeCtx);
    if ('type' in handlerResult) {
      return handlerResult.type === 'return' ? { type: 'return', env } : { type: 'wait' };
    }

    env = handlerResult as Envelope;
    const nextPath = findNextPath(definition, path, env, resolveStepAtPath(definition, path).stack);

    return { type: 'continue', env, nextPath };
  }

  private expressionContext(env: Envelope) {
    return {
      payload: env.payload,
      vars: env.vars,
      meta: env.meta,
      error: env.error
    };
  }

  private async executeAction(
    knex: Knex,
    runId: string,
    stepPath: string,
    actionId: string,
    version: number,
    args: unknown,
    providedIdempotencyKey?: string,
    tenantId?: string | null,
    redactions: string[] = []
  ): Promise<unknown> {
    const actionRegistry = getActionRegistryV2();
    const action = actionRegistry.get(actionId, version);
    if (!action) {
      throw createRuntimeError('ValidationError', `Unknown action ${actionId}@${version}`, stepPath);
    }

    const input = action.inputSchema.parse(args);

    let idempotencyKey = providedIdempotencyKey
      ? String(providedIdempotencyKey)
      : action.idempotency.mode === 'actionProvided'
        ? action.idempotency.key(input, {
            runId,
            stepPath,
            tenantId,
            idempotencyKey: '',
            attempt: 1,
            nowIso: () => new Date().toISOString(),
            env: {},
            knex
          })
        : generateIdempotencyKey(runId, stepPath, actionId, version, input);
    if (tenantId) {
      idempotencyKey = `${tenantId}:${idempotencyKey}`;
    }

    const existing = await WorkflowActionInvocationModelV2.findByIdempotency(knex, actionId, version, idempotencyKey);
    let invocation = null as Awaited<ReturnType<typeof WorkflowActionInvocationModelV2.create>> | null;
    if (existing) {
      if (existing.status === 'SUCCEEDED') {
        return action.outputSchema.parse(existing.output_json ?? {});
      }
      if (existing.status === 'STARTED') {
        if (existing.lease_expires_at && new Date(existing.lease_expires_at).getTime() < Date.now()) {
          throw createRuntimeError('TransientError', 'Stale action lease detected', stepPath);
        }
        throw createRuntimeError('TransientError', 'Action invocation already in progress', stepPath);
      }
      if (existing.status === 'FAILED') {
        invocation = await WorkflowActionInvocationModelV2.update(knex, existing.invocation_id, {
          status: 'STARTED',
          attempt: (existing.attempt ?? 1) + 1,
          lease_owner: `run:${runId}`,
          lease_expires_at: new Date(Date.now() + LEASE_MS).toISOString(),
          input_json: applyRedactions(safeSerialize(input), redactions) as Record<string, unknown>,
          started_at: new Date().toISOString(),
          error_message: null
        });
      }
    }

    if (!invocation) {
      invocation = await WorkflowActionInvocationModelV2.create(knex, {
        run_id: runId,
        step_path: stepPath,
        action_id: actionId,
        action_version: version,
        idempotency_key: idempotencyKey,
        status: 'STARTED',
        attempt: 1,
        lease_owner: `run:${runId}`,
        lease_expires_at: new Date(Date.now() + LEASE_MS).toISOString(),
        input_json: applyRedactions(safeSerialize(input), redactions) as Record<string, unknown>,
        started_at: new Date().toISOString()
      });
    }

    try {
      const output = await action.handler(input, {
        runId,
        stepPath,
        tenantId,
        idempotencyKey,
        attempt: invocation.attempt,
        nowIso: () => new Date().toISOString(),
        env: {},
        knex
      });
      const validatedOutput = action.outputSchema.parse(output);
      await WorkflowActionInvocationModelV2.update(knex, invocation.invocation_id, {
        status: 'SUCCEEDED',
        output_json: applyRedactions(safeSerialize(validatedOutput), redactions) as Record<string, unknown>,
        completed_at: new Date().toISOString()
      });
      return validatedOutput;
    } catch (error) {
      await WorkflowActionInvocationModelV2.update(knex, invocation.invocation_id, {
        status: 'FAILED',
        error_message: error instanceof Error ? error.message : String(error),
        completed_at: new Date().toISOString()
      });
      throw createRuntimeError('ActionError', error instanceof Error ? error.message : String(error), stepPath);
    }
  }

  private async persistSnapshot(knex: Knex, runId: string, stepPath: string, env: Envelope): Promise<string> {
    const redactions = env.meta.redactions ?? [];
    const sanitized = applyRedactions(env, redactions);
    const serializable = safeSerialize(sanitized);
    const sized = enforceSnapshotSize(serializable, SNAPSHOT_MAX_BYTES);
    const snapshotRecord = await WorkflowRunSnapshotModelV2.create(knex, {
      run_id: runId,
      step_path: stepPath,
      envelope_json: sized as Record<string, unknown>,
      size_bytes: JSON.stringify(sized).length
    });
    if (Number.isFinite(SNAPSHOT_RETENTION_DAYS) && SNAPSHOT_RETENTION_DAYS > 0) {
      const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      await knex('workflow_run_snapshots')
        .where({ run_id: runId })
        .andWhere('created_at', '<', cutoff)
        .del();
    }
    return snapshotRecord.snapshot_id;
  }

  private async nextAttempt(knex: Knex, runId: string, stepPath: string): Promise<number> {
    const last = await WorkflowRunStepModelV2.getLatestByRunAndPath(knex, runId, stepPath);
    if (!last) return 1;
    return last.attempt + 1;
  }

  private async markRunCompleted(knex: Knex, runId: string, status: WorkflowRunStatus): Promise<void> {
    await WorkflowRunModelV2.update(knex, runId, {
      status,
      node_path: null,
      completed_at: new Date().toISOString()
    });
  }
}

function resolveStepAtPath(definition: WorkflowDefinition, path: string): { step: Step | null; stack: PathStack } {
  const segments = parseNodePath(path);
  let currentSteps: Step[] = definition.steps;
  let currentStep: Step | null = null;
  const stack: PathStack = [];
  let containerPath = 'root';
  let currentStepPath = 'root';

  for (const segment of segments) {
    if (segment.type === 'steps') {
      currentStep = currentSteps[segment.index] ?? null;
      currentStepPath = `${containerPath}.steps[${segment.index}]`;
      stack.push({
        containerPath,
        steps: currentSteps,
        index: segment.index,
        parentStep: currentStep
      });
      if (!currentStep) {
        break;
      }
    } else {
      if (!currentStep) {
        return { step: null, stack };
      }
      const block = (currentStep as any)[segment.type] as Step[] | undefined;
      if (!block) {
        return { step: null, stack };
      }
      containerPath = `${currentStepPath}.${segment.type}`;
      currentSteps = block;
    }
  }

  return { step: currentStep, stack };
}

type PathStackEntry = {
  containerPath: string;
  steps: Step[];
  index: number;
  parentStep?: Step;
};

type PathStack = PathStackEntry[];

function findNextPath(definition: WorkflowDefinition, currentPath: string, env: Envelope, stack: PathStack): string | null {
  const forEachContext = resolveForEachLoopContext(definition, currentPath, env, stack);
  if (forEachContext) {
    const { loopContext, forEachPath, bodyEntry } = forEachContext;
    if (bodyEntry.index === bodyEntry.steps.length - 1) {
      if (loopContext && loopContext.index < loopContext.items.length - 1) {
        loopContext.index += 1;
        env.vars[loopContext.itemVar] = loopContext.items[loopContext.index];
        return `${forEachPath}.body.steps[0]`;
      }
      if (loopContext) {
        env.vars[loopContext.itemVar] = loopContext.previous;
        if (env.vars.__forEach && typeof env.vars.__forEach === 'object') {
          delete (env.vars.__forEach as Record<string, unknown>)[forEachContext.stepId];
        }
      }
      const base = resolveStepAtPath(definition, forEachPath);
      return findNextPath(definition, forEachPath, env, base.stack);
    }
  }

  if (!stack.length) return null;
  const stackCopy = [...stack];
  while (stackCopy.length > 0) {
    const entry = stackCopy.pop()!;
    const nextIndex = entry.index + 1;
    if (nextIndex < entry.steps.length) {
      return `${entry.containerPath}.steps[${nextIndex}]`;
    }
  }
  return null;
}

function resolveRetryPolicy(step: Step): RetryPolicy | null {
  if ('retry' in step && step.retry) {
    return step.retry;
  }
  if (step.type === 'action.call') {
    const config = step.config as { actionId?: string; version?: number } | undefined;
    if (config?.actionId && config.version) {
      const action = getActionRegistryV2().get(config.actionId, config.version);
      if (action?.retryHint) {
        return action.retryHint;
      }
    }
  }
  const nodeType = getNodeTypeRegistry().get(step.type);
  if (nodeType?.defaultRetry) {
    return nodeType.defaultRetry as RetryPolicy;
  }
  return null;
}

function isRetryable(error: RuntimeError, policy: RetryPolicy, attempt: number): boolean {
  if (!policy) return false;
  if (policy.retryOn && !policy.retryOn.includes(error.category)) {
    return false;
  }
  if (policy.maxAttempts && attempt >= policy.maxAttempts) {
    return false;
  }
  return true;
}


function getOnErrorPolicy(step: Step): 'continue' | 'fail' {
  if ('onError' in step && step.onError?.policy) {
    return step.onError.policy;
  }
  if (step.type === 'action.call') {
    const config = step.config as any;
    if (config?.onError?.policy) {
      return config.onError.policy;
    }
  }
  return 'fail';
}

function findCatchPath(definition: WorkflowDefinition, currentPath: string, stack: PathStack, error: RuntimeError, env: Envelope): string | null {
  const segments = currentPath.split('.');
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (segment === 'try') {
      const base = segments.slice(0, i).join('.');
      const tryStep = resolveStepAtPath(definition, base).step;
      if (tryStep && tryStep.type === 'control.tryCatch') {
        const tryCatchStep = tryStep as Step & { type: 'control.tryCatch'; catch: Step[]; captureErrorAs?: string };
        if (tryCatchStep.captureErrorAs) {
          env.vars[tryCatchStep.captureErrorAs] = error;
        }
        if (tryCatchStep.catch.length > 0) {
          return `${base}.catch.steps[0]`;
        }
        return findNextPath(definition, base, env, resolveStepAtPath(definition, base).stack);
      }
    }
  }
  return null;
}

function createRuntimeError(category: WorkflowErrorCategory, message: string, nodePath: string): RuntimeError {
  return {
    category,
    message,
    nodePath,
    at: new Date().toISOString()
  };
}

function toRuntimeError(error: unknown, nodePath: string): RuntimeError {
  if (typeof error === 'object' && error && 'category' in error) {
    return error as RuntimeError;
  }
  return createRuntimeError('ActionError', error instanceof Error ? error.message : String(error), nodePath);
}

function applyErrorToEnv(env: Envelope, error: RuntimeError, nodePath: string): Envelope {
  return {
    ...env,
    error: {
      name: error.category,
      message: error.message,
      nodePath,
      at: error.at,
      data: error
    }
  };
}

type RuntimeError = {
  category: WorkflowErrorCategory;
  message: string;
  nodePath: string;
  at: string;
};

async function resolveMapping(env: Envelope, mapping?: Record<string, { $expr: string }>): Promise<Record<string, unknown> | null> {
  if (!mapping) return null;
  const ctx = {
    payload: env.payload,
    vars: env.vars,
    meta: env.meta,
    error: env.error
  };
  const result: Record<string, unknown> = {};
  for (const [key, expr] of Object.entries(mapping)) {
    result[key] = await resolveExpressions(expr, ctx);
  }
  return result;
}


function findEnclosingForEach(definition: WorkflowDefinition, path: string, env: Envelope): { itemVar: string; item: unknown } | null {
  const segments = path.split('.');
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i] === 'body') {
      const base = segments.slice(0, i).join('.');
      const step = resolveStepAtPath(definition, base).step;
      if (step && step.type === 'control.forEach') {
        const loopContext = (env.vars.__forEach as any)?.[step.id];
        if (loopContext) {
          return {
            itemVar: loopContext.itemVar,
            item: loopContext.items?.[loopContext.index]
          };
        }
      }
    }
  }
  return null;
}

function resolveForEachOnItemError(definition: WorkflowDefinition, path: string): 'continue' | 'fail' | null {
  const segments = path.split('.');
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i] === 'body') {
      const base = segments.slice(0, i).join('.');
      const step = resolveStepAtPath(definition, base).step;
      if (step && step.type === 'control.forEach') {
        const forEachStep = step as Step & { type: 'control.forEach'; onItemError?: 'continue' | 'fail' };
        return forEachStep.onItemError ?? 'fail';
      }
    }
  }
  return null;
}

function resolveForEachLoopContext(
  definition: WorkflowDefinition,
  path: string,
  env: Envelope,
  stack: PathStack
): { loopContext: any; forEachPath: string; bodyEntry: PathStackEntry; stepId: string } | null {
  const bodyEntry = [...stack].reverse().find((entry) => entry.containerPath.endsWith('.body'));
  if (!bodyEntry) return null;
  const forEachPath = bodyEntry.containerPath.replace(/\\.body$/, '');
  const forEachStep = resolveStepAtPath(definition, forEachPath).step;
  if (!forEachStep || forEachStep.type !== 'control.forEach') return null;
  const loopContext = (env.vars.__forEach as any)?.[forEachStep.id];
  return { loopContext, forEachPath, bodyEntry, stepId: forEachStep.id };
}
