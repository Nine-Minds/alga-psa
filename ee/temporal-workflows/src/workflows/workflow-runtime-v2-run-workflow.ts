import { continueAsNew, proxyActivities } from '@temporalio/workflow';
import type { WorkflowRuntimeV2TemporalRunInput } from '@alga-psa/workflows/lib/workflowRuntimeV2Temporal';
import type { Expr, IfBlock } from '@alga-psa/workflows/runtime';
import jsonata from 'jsonata';
import {
  advanceWorkflowRuntimeV2InterpreterState,
  createWorkflowRuntimeV2InterpreterCheckpoint,
  buildWorkflowRuntimeV2ExpressionContext,
  getWorkflowRuntimeV2CurrentStep,
  initializeWorkflowRuntimeV2InterpreterState,
  pushWorkflowRuntimeV2SequenceFrame,
  type WorkflowRuntimeV2InterpreterCheckpoint,
  type WorkflowRuntimeV2InterpreterState,
  type WorkflowRuntimeV2ScopeState,
} from './workflow-runtime-v2-interpreter.js';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime';

const activities = proxyActivities<{
  loadWorkflowRuntimeV2PinnedDefinition(input: {
    runId: string;
    workflowId: string;
    workflowVersion: number;
  }): Promise<{
    definition: WorkflowDefinition;
    initialScopes: WorkflowRuntimeV2ScopeState;
  }>;
  executeWorkflowRuntimeV2Run(input: { runId: string; executionKey: string }): Promise<void>;
  projectWorkflowRuntimeV2StepStart(input: {
    runId: string;
    stepPath: string;
    definitionStepId: string;
  }): Promise<{ stepId: string }>;
  projectWorkflowRuntimeV2StepCompletion(input: {
    runId: string;
    stepId: string;
    stepPath: string;
    status: 'SUCCEEDED' | 'FAILED';
    errorMessage?: string;
  }): Promise<void>;
  executeWorkflowRuntimeV2ActionStep(input: {
    runId: string;
    stepPath: string;
    stepId: string;
    tenantId: string | null;
    step: {
      type: 'action.call';
      config?: unknown;
    };
    scopes: WorkflowRuntimeV2ScopeState;
  }): Promise<{ output: unknown; saveAsPath: string | null }>;
  completeWorkflowRuntimeV2Run(input: { runId: string; status: 'SUCCEEDED' | 'FAILED' }): Promise<void>;
}>({
  startToCloseTimeout: '10m',
  retry: {
    maximumAttempts: 1,
  },
});

const CONTINUE_AS_NEW_EVERY_STEPS = 250;

type WorkflowRuntimeV2RunWorkflowInput = WorkflowRuntimeV2TemporalRunInput & {
  checkpoint?: WorkflowRuntimeV2InterpreterCheckpoint;
};

export async function workflowRuntimeV2RunWorkflow(input: WorkflowRuntimeV2RunWorkflowInput): Promise<void> {
  const pinned = await activities.loadWorkflowRuntimeV2PinnedDefinition({
    runId: input.runId,
    workflowId: input.workflowId,
    workflowVersion: input.workflowVersion,
  });

  let state: WorkflowRuntimeV2InterpreterState = input.checkpoint?.state ?? initializeWorkflowRuntimeV2InterpreterState({
    runId: input.runId,
    definition: pinned.definition,
    initialScopes: pinned.initialScopes,
  });
  let stepCount = input.checkpoint?.stepCount ?? 0;

  while (true) {
    const current = getWorkflowRuntimeV2CurrentStep({
      state,
      definition: pinned.definition,
    });

    if (!current) {
      await activities.completeWorkflowRuntimeV2Run({ runId: input.runId, status: 'SUCCEEDED' });
      return;
    }

    state = {
      ...state,
      currentStepPath: current.path,
    };

    const stepProjection = await activities.projectWorkflowRuntimeV2StepStart({
      runId: input.runId,
      stepPath: current.path,
      definitionStepId: current.step.id,
    });

    try {
      if (current.step.type === 'control.return') {
        await activities.projectWorkflowRuntimeV2StepCompletion({
          runId: input.runId,
          stepId: stepProjection.stepId,
          stepPath: current.path,
          status: 'SUCCEEDED',
        });
        await activities.completeWorkflowRuntimeV2Run({ runId: input.runId, status: 'SUCCEEDED' });
        return;
      }

      if (current.step.type === 'control.if') {
        const ifStep = current.step as IfBlock;
        const branchKey = await evaluateDeterministicBooleanExpression(ifStep.condition, state.scopes) ? 'then' : 'else';
        const branchSteps = branchKey === 'then' ? ifStep.then : (ifStep.else ?? []);
        state = advanceWorkflowRuntimeV2InterpreterState(state);
        state = pushWorkflowRuntimeV2SequenceFrame(state, {
          path: `${current.path}.${branchKey}.steps`,
          totalSteps: branchSteps.length,
        });
        await activities.projectWorkflowRuntimeV2StepCompletion({
          runId: input.runId,
          stepId: stepProjection.stepId,
          stepPath: current.path,
          status: 'SUCCEEDED',
        });
        stepCount += 1;
        continue;
      }

      if (current.step.type === 'action.call') {
        const actionResult = await activities.executeWorkflowRuntimeV2ActionStep({
          runId: input.runId,
          stepPath: current.path,
          stepId: stepProjection.stepId,
          tenantId: state.scopes.system.tenantId,
          step: {
            type: 'action.call',
            config: current.step.config,
          },
          scopes: state.scopes,
        });
        if (actionResult.saveAsPath) {
          state = assignToScopePath(state, actionResult.saveAsPath, actionResult.output);
        }
        state = advanceWorkflowRuntimeV2InterpreterState(state);
        await activities.projectWorkflowRuntimeV2StepCompletion({
          runId: input.runId,
          stepId: stepProjection.stepId,
          stepPath: current.path,
          status: 'SUCCEEDED',
        });
        stepCount += 1;
        continue;
      }

      // Temporary bridge while additional step handlers are moved into the Temporal-native interpreter.
      await activities.executeWorkflowRuntimeV2Run({
        runId: input.runId,
        executionKey: input.executionKey,
      });
      state = advanceWorkflowRuntimeV2InterpreterState(state);
      await activities.projectWorkflowRuntimeV2StepCompletion({
        runId: input.runId,
        stepId: stepProjection.stepId,
        stepPath: current.path,
        status: 'SUCCEEDED',
      });
      stepCount += 1;
    } catch (error) {
      await activities.projectWorkflowRuntimeV2StepCompletion({
        runId: input.runId,
        stepId: stepProjection.stepId,
        stepPath: current.path,
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await activities.completeWorkflowRuntimeV2Run({ runId: input.runId, status: 'FAILED' });
      throw error;
    }

    if (stepCount > 0 && stepCount % CONTINUE_AS_NEW_EVERY_STEPS === 0) {
      const checkpoint = createWorkflowRuntimeV2InterpreterCheckpoint({
        state,
        stepCount,
      });
      await continueAsNew<typeof workflowRuntimeV2RunWorkflow>({
        ...input,
        checkpoint,
      });
    }
  }
}

async function evaluateDeterministicBooleanExpression(expr: Expr, scopes: WorkflowRuntimeV2ScopeState): Promise<boolean> {
  assertDeterministicExpression(expr.$expr);
  const expressionContext = buildWorkflowRuntimeV2ExpressionContext(scopes);
  const value = await evaluateExpression(expr.$expr, expressionContext);
  if (typeof value !== 'boolean') {
    throw new Error('control.if condition must evaluate to a boolean');
  }
  return value;
}

function assertDeterministicExpression(source: string): void {
  // nowIso depends on wall-clock time and is intentionally disallowed in control-flow decisions.
  if (/\$?nowIso\s*\(/.test(source)) {
    throw new Error('Expression function nowIso() is not allowed in Temporal interpreter control flow');
  }
}

function assignToScopePath(
  state: WorkflowRuntimeV2InterpreterState,
  saveAs: string,
  output: unknown
): WorkflowRuntimeV2InterpreterState {
  const normalized = normalizeAssignmentPath(saveAs);
  const scopes = {
    payload: cloneRecord(state.scopes.payload),
    workflow: cloneRecord(state.scopes.workflow),
    lexical: state.scopes.lexical.map((scope) => cloneRecord(scope)),
    system: state.scopes.system,
  };

  if (normalized.startsWith('payload.')) {
    setNestedValue(scopes.payload, normalized.slice('payload.'.length), output);
  } else if (normalized.startsWith('vars.')) {
    setNestedValue(scopes.workflow, normalized.slice('vars.'.length), output);
  } else if (normalized.startsWith('local.')) {
    const topLexical = scopes.lexical[scopes.lexical.length - 1];
    if (topLexical) {
      setNestedValue(topLexical, normalized.slice('local.'.length), output);
    } else {
      setNestedValue(scopes.workflow, normalized.slice('local.'.length), output);
    }
  } else if (normalized.startsWith('meta.')) {
    setNestedValue(scopes.workflow, normalized.slice('meta.'.length), output);
  } else {
    setNestedValue(scopes.workflow, normalized, output);
  }

  return {
    ...state,
    scopes,
  };
}

function normalizeAssignmentPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return 'vars';

  const scoped = trimmed.startsWith('payload.')
    || trimmed.startsWith('vars.')
    || trimmed.startsWith('meta.')
    || trimmed.startsWith('local.')
    || trimmed.startsWith('/');
  if (!scoped) {
    return `vars.${trimmed}`;
  }

  if (!trimmed.startsWith('/')) {
    return trimmed;
  }

  const pointer = trimmed
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .join('.');
  return pointer || 'vars';
}

function setNestedValue(target: Record<string, unknown>, dottedPath: string, value: unknown): void {
  const parts = dottedPath.split('.').filter((part) => part.length > 0);
  if (parts.length === 0) {
    return;
  }
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < parts.length; index += 1) {
    const key = parts[index];
    if (index === parts.length - 1) {
      cursor[key] = value;
      return;
    }
    const existing = cursor[key];
    if (!isRecord(existing)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
}

async function evaluateExpression(source: string, context: Record<string, unknown>): Promise<unknown> {
  const expression = jsonata(normalizeExpressionSource(source));
  expression.registerFunction('coalesce', (...args: unknown[]) => {
    for (const arg of args) {
      if (arg !== null && arg !== undefined) return arg;
    }
    return null;
  });
  expression.registerFunction('len', (value: unknown) => {
    if (typeof value === 'string' || Array.isArray(value)) {
      return value.length;
    }
    return 0;
  });
  expression.registerFunction('toString', (value: unknown) => {
    if (value === null || value === undefined) return '';
    return String(value);
  });
  expression.registerFunction('append', (list: unknown, value: unknown) => {
    const base = Array.isArray(list) ? list : list === null || list === undefined ? [] : [list];
    const toAdd = Array.isArray(value) ? value : [value];
    return base.concat(toAdd);
  });

  return await Promise.resolve(expression.evaluate(context));
}

function normalizeExpressionSource(source: string): string {
  return source.replace(/==/g, '=').replace(
    /(^|[^.$A-Za-z0-9_])(coalesce|len|toString|append)(?=\s*\()/g,
    (_match, prefix: string, fn: string) => `${prefix}$${fn}`
  );
}
