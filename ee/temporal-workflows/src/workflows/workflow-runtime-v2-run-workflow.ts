import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import type { WorkflowRuntimeV2TemporalRunInput } from '@alga-psa/workflows/lib/workflowRuntimeV2Temporal';
import type { Expr, ForEachBlock, IfBlock } from '@alga-psa/workflows/runtime';
import type { RetryPolicy, OnErrorPolicy } from '@alga-psa/workflows/runtime';
import type { TryCatchBlock, WorkflowDefinition } from '@alga-psa/workflows/runtime';
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
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
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
  completeWorkflowRuntimeV2Run(input: { runId: string; status: 'SUCCEEDED' | 'FAILED' | 'CANCELED' }): Promise<void>;
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
      if (state.frames.length > 0) {
        const corruptionError = createInterpreterCorruptionError(
          `Interpreter frames remained but no current step could be resolved for run ${input.runId}`,
          { frames: state.frames }
        );
        await activities.completeWorkflowRuntimeV2Run({ runId: input.runId, status: 'FAILED' });
        throw corruptionError;
      }
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

      if (current.step.type === 'control.tryCatch') {
        const tryCatchStep = current.step as TryCatchBlock;
        state = advanceWorkflowRuntimeV2InterpreterState(state);
        state = pushWorkflowRuntimeV2SequenceFrame(state, {
          path: `${current.path}.try.steps`,
          totalSteps: tryCatchStep.try.length,
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

      if (current.step.type === 'control.forEach') {
        const forEachStep = current.step as ForEachBlock;
        const resolvedItems = await evaluateDeterministicArrayExpression(forEachStep.items, state.scopes);
        const hadPrevious = Object.prototype.hasOwnProperty.call(state.scopes.workflow, forEachStep.itemVar);
        const previous = state.scopes.workflow[forEachStep.itemVar];

        state = setForEachLoopContext(state, {
          loopId: forEachStep.id,
          loopContext: {
            items: resolvedItems,
            index: 0,
            itemVar: forEachStep.itemVar,
            previous,
            hadPrevious,
          },
        });
        state = advanceWorkflowRuntimeV2InterpreterState(state);
        if (resolvedItems.length > 0 && forEachStep.body.length > 0) {
          state = assignToScopePath(state, `vars.${forEachStep.itemVar}`, resolvedItems[0]);
          state = upsertForEachLexicalScope(state, {
            loopId: forEachStep.id,
            itemVar: forEachStep.itemVar,
            item: resolvedItems[0],
            index: 0,
            length: resolvedItems.length,
          });
          state = pushWorkflowRuntimeV2SequenceFrame(state, {
            path: `${current.path}.body.steps`,
            totalSteps: forEachStep.body.length,
          });
        } else {
          state = clearForEachLoopContext(state, forEachStep.id);
          state = restoreForEachItemVar(state, forEachStep.itemVar, {
            previous,
            hadPrevious,
          });
          state = clearForEachLexicalScope(state, forEachStep.id);
        }
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
        const retryPolicy = resolveStepRetryPolicy(current.step);
        const onErrorPolicy = resolveStepOnErrorPolicy(current.step);
        let handledByOnError = false;
        let attempt = 1;
        while (true) {
          try {
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
            break;
          } catch (error) {
            if (isUncatchableWorkflowError(error)) {
              throw error;
            }
            const runtimeError = normalizeRuntimeError(error, current.path);
            if (shouldRetry(runtimeError, retryPolicy, attempt)) {
              const backoffMs = getRetryBackoffMs(retryPolicy!, attempt);
              attempt += 1;
              await sleep(backoffMs);
              continue;
            }

            if (onErrorPolicy === 'continue') {
              state = assignToScopePath(state, 'vars.error', runtimeError);
              await activities.projectWorkflowRuntimeV2StepCompletion({
                runId: input.runId,
                stepId: stepProjection.stepId,
                stepPath: current.path,
                status: 'SUCCEEDED',
                errorMessage: runtimeError.message,
              });
              state = advanceWorkflowRuntimeV2InterpreterState(state);
              state = advanceWorkflowRuntimeV2ForEachLoopState(state, pinned.definition, current.path);
              stepCount += 1;
              handledByOnError = true;
              break;
            }

            throw runtimeError;
          }
        }
        if (handledByOnError) {
          continue;
        }
        state = advanceWorkflowRuntimeV2InterpreterState(state);
        state = advanceWorkflowRuntimeV2ForEachLoopState(state, pinned.definition, current.path);
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
      state = advanceWorkflowRuntimeV2ForEachLoopState(state, pinned.definition, current.path);
      await activities.projectWorkflowRuntimeV2StepCompletion({
        runId: input.runId,
        stepId: stepProjection.stepId,
        stepPath: current.path,
        status: 'SUCCEEDED',
      });
      stepCount += 1;
    } catch (error) {
      const runtimeError = normalizeRuntimeError(error, current.path);
      if (isCancellationRuntimeError(runtimeError)) {
        await activities.projectWorkflowRuntimeV2StepCompletion({
          runId: input.runId,
          stepId: stepProjection.stepId,
          stepPath: current.path,
          status: 'CANCELED',
          errorMessage: runtimeError.message,
        });
        await activities.completeWorkflowRuntimeV2Run({ runId: input.runId, status: 'CANCELED' });
        throw error;
      }

      if (isInterpreterCorruptionRuntimeError(runtimeError)) {
        await activities.projectWorkflowRuntimeV2StepCompletion({
          runId: input.runId,
          stepId: stepProjection.stepId,
          stepPath: current.path,
          status: 'FAILED',
          errorMessage: runtimeError.message,
        });
        await activities.completeWorkflowRuntimeV2Run({ runId: input.runId, status: 'FAILED' });
        throw error;
      }

      await activities.projectWorkflowRuntimeV2StepCompletion({
        runId: input.runId,
        stepId: stepProjection.stepId,
        stepPath: current.path,
        status: 'FAILED',
        errorMessage: runtimeError.message,
      });

      const tryCatchRoutedState = routeTryCatchFailure({
        state,
        definition: pinned.definition,
        failedStepPath: current.path,
        runtimeError,
      });
      if (tryCatchRoutedState) {
        state = tryCatchRoutedState;
        stepCount += 1;
        continue;
      }

      const forEachContinueState = routeForEachOnItemError({
        state,
        definition: pinned.definition,
        failedStepPath: current.path,
      });
      if (forEachContinueState) {
        state = forEachContinueState;
        stepCount += 1;
        continue;
      }

      await activities.completeWorkflowRuntimeV2Run({ runId: input.runId, status: 'FAILED' });
      throw runtimeError;
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

async function evaluateDeterministicArrayExpression(expr: Expr, scopes: WorkflowRuntimeV2ScopeState): Promise<unknown[]> {
  assertDeterministicExpression(expr.$expr);
  const expressionContext = buildWorkflowRuntimeV2ExpressionContext(scopes);
  const value = await evaluateExpression(expr.$expr, expressionContext);
  if (!Array.isArray(value)) {
    throw new Error('control.forEach items did not evaluate to an array');
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

type ForEachLoopContext = {
  items: unknown[];
  index: number;
  itemVar: string;
  previous: unknown;
  hadPrevious: boolean;
};

type ForEachLexicalScope = Record<string, unknown> & {
  __loopId: string;
  item: unknown;
  index: number;
  length: number;
  isFirst: boolean;
  isLast: boolean;
};

function getForEachLoopRecord(state: WorkflowRuntimeV2InterpreterState): Record<string, ForEachLoopContext> {
  const raw = state.scopes.workflow.__forEach;
  if (!isRecord(raw)) {
    return {};
  }
  const entries = Object.entries(raw);
  const normalized = entries.filter((entry) => isForEachLoopContext(entry[1]));
  return Object.fromEntries(normalized) as Record<string, ForEachLoopContext>;
}

function setForEachLoopContext(
  state: WorkflowRuntimeV2InterpreterState,
  input: {
    loopId: string;
    loopContext: ForEachLoopContext;
  }
): WorkflowRuntimeV2InterpreterState {
  const loops = getForEachLoopRecord(state);
  loops[input.loopId] = input.loopContext;
  return assignToScopePath(state, 'vars.__forEach', loops);
}

function clearForEachLoopContext(state: WorkflowRuntimeV2InterpreterState, loopId: string): WorkflowRuntimeV2InterpreterState {
  const loops = getForEachLoopRecord(state);
  delete loops[loopId];
  return assignToScopePath(state, 'vars.__forEach', loops);
}

function restoreForEachItemVar(
  state: WorkflowRuntimeV2InterpreterState,
  itemVar: string,
  previous: { previous: unknown; hadPrevious: boolean }
): WorkflowRuntimeV2InterpreterState {
  const workflowScope = cloneRecord(state.scopes.workflow);
  if (previous.hadPrevious) {
    workflowScope[itemVar] = previous.previous;
  } else {
    delete workflowScope[itemVar];
  }
  return {
    ...state,
    scopes: {
      ...state.scopes,
      workflow: workflowScope,
    },
  };
}

function upsertForEachLexicalScope(
  state: WorkflowRuntimeV2InterpreterState,
  input: {
    loopId: string;
    itemVar: string;
    item: unknown;
    index: number;
    length: number;
  }
): WorkflowRuntimeV2InterpreterState {
  const lexicalScope: ForEachLexicalScope = {
    __loopId: input.loopId,
    [input.itemVar]: input.item,
    item: input.item,
    index: input.index,
    length: input.length,
    isFirst: input.index === 0,
    isLast: input.index === input.length - 1,
  };
  const lexical = [...state.scopes.lexical];
  const top = lexical[lexical.length - 1];
  if (isForEachLexicalScope(top) && top.__loopId === input.loopId) {
    lexical[lexical.length - 1] = lexicalScope;
  } else {
    lexical.push(lexicalScope);
  }

  return {
    ...state,
    scopes: {
      ...state.scopes,
      lexical,
    },
  };
}

function clearForEachLexicalScope(state: WorkflowRuntimeV2InterpreterState, loopId: string): WorkflowRuntimeV2InterpreterState {
  const lexical = [...state.scopes.lexical];
  const top = lexical[lexical.length - 1];
  if (isForEachLexicalScope(top) && top.__loopId === loopId) {
    lexical.pop();
    return {
      ...state,
      scopes: {
        ...state.scopes,
        lexical,
      },
    };
  }
  return state;
}

function advanceWorkflowRuntimeV2ForEachLoopState(
  state: WorkflowRuntimeV2InterpreterState,
  definition: WorkflowDefinition,
  completedStepPath: string
): WorkflowRuntimeV2InterpreterState {
  const loopProgress = resolveCompletedForEachBodyStep(definition, completedStepPath);
  if (!loopProgress) {
    return state;
  }

  const loops = getForEachLoopRecord(state);
  const loopContext = loops[loopProgress.loopId];
  if (!loopContext) {
    throw createInterpreterCorruptionError(
      `Missing control.forEach context for loop ${loopProgress.loopId} while processing ${completedStepPath}`
    );
  }
  if (loopContext.index >= loopContext.items.length - 1) {
    let nextState = clearForEachLoopContext(state, loopProgress.loopId);
    nextState = restoreForEachItemVar(nextState, loopContext.itemVar, {
      previous: loopContext.previous,
      hadPrevious: loopContext.hadPrevious,
    });
    nextState = clearForEachLexicalScope(nextState, loopProgress.loopId);
    return nextState;
  }

  const nextIndex = loopContext.index + 1;
  const updatedLoopContext: ForEachLoopContext = {
    ...loopContext,
    index: nextIndex,
  };

  let nextState = setForEachLoopContext(state, {
    loopId: loopProgress.loopId,
    loopContext: updatedLoopContext,
  });
  nextState = assignToScopePath(nextState, `vars.${loopContext.itemVar}`, loopContext.items[nextIndex]);
  nextState = upsertForEachLexicalScope(nextState, {
    loopId: loopProgress.loopId,
    itemVar: loopContext.itemVar,
    item: loopContext.items[nextIndex],
    index: nextIndex,
    length: loopContext.items.length,
  });
  nextState = pushWorkflowRuntimeV2SequenceFrame(nextState, {
    path: loopProgress.bodyPath,
    totalSteps: loopProgress.bodyLength,
  });
  return nextState;
}

function resolveCompletedForEachBodyStep(
  definition: WorkflowDefinition,
  completedStepPath: string
): {
  loopId: string;
  bodyPath: string;
  bodyLength: number;
} | null {
  const match = /^root\.steps\[(\d+)\]\.body\.steps\[(\d+)\](?:\..+)?$/.exec(completedStepPath);
  if (!match) {
    return null;
  }
  const parentIndex = Number(match[1]);
  const bodyIndex = Number(match[2]);
  if (!Number.isInteger(parentIndex) || !Number.isInteger(bodyIndex)) {
    return null;
  }
  const parentStep = definition.steps[parentIndex];
  if (!parentStep || parentStep.type !== 'control.forEach') {
    return null;
  }
  const forEachStep = parentStep as ForEachBlock;
  if (bodyIndex !== forEachStep.body.length - 1) {
    return null;
  }
  return {
    loopId: forEachStep.id,
    bodyPath: `root.steps[${parentIndex}].body.steps`,
    bodyLength: forEachStep.body.length,
  };
}

function isForEachLoopContext(value: unknown): value is ForEachLoopContext {
  if (!isRecord(value)) {
    return false;
  }
  return Array.isArray(value.items)
    && typeof value.index === 'number'
    && typeof value.itemVar === 'string'
    && typeof value.hadPrevious === 'boolean';
}

function isForEachLexicalScope(value: unknown): value is ForEachLexicalScope {
  return isRecord(value) && typeof value.__loopId === 'string';
}

function routeForEachOnItemError(input: {
  state: WorkflowRuntimeV2InterpreterState;
  definition: WorkflowDefinition;
  failedStepPath: string;
}): WorkflowRuntimeV2InterpreterState | null {
  const forEachPath = resolveForEachPathFromBodyStep(input.failedStepPath);
  if (!forEachPath) {
    return null;
  }
  const forEachStep = resolveTopLevelForEachStep(input.definition, forEachPath);
  if (!forEachStep) {
    return null;
  }
  if ((forEachStep.onItemError ?? 'fail') !== 'continue') {
    return null;
  }

  let nextState = advanceWorkflowRuntimeV2InterpreterState(input.state);
  nextState = advanceWorkflowRuntimeV2ForEachLoopState(nextState, input.definition, input.failedStepPath);
  return nextState;
}

function resolveForEachPathFromBodyStep(stepPath: string): string | null {
  const match = /^(root\.steps\[\d+\])\.body\.steps\[\d+\](?:\..+)?$/.exec(stepPath);
  if (!match) {
    return null;
  }
  return match[1];
}

function resolveTopLevelForEachStep(definition: WorkflowDefinition, forEachPath: string): ForEachBlock | null {
  const match = /^root\.steps\[(\d+)\]$/.exec(forEachPath);
  if (!match) {
    return null;
  }
  const stepIndex = Number(match[1]);
  if (!Number.isInteger(stepIndex) || stepIndex < 0) {
    return null;
  }
  const step = definition.steps[stepIndex];
  if (!step || step.type !== 'control.forEach') {
    return null;
  }
  return step as ForEachBlock;
}

type RuntimeErrorLike = {
  category: string;
  message: string;
  nodePath: string;
  at: string;
  code?: string;
  details?: unknown;
};

function normalizeRuntimeError(error: unknown, stepPath: string): RuntimeErrorLike {
  if (isRuntimeErrorLike(error)) {
    return {
      category: error.category,
      message: error.message,
      nodePath: typeof error.nodePath === 'string' ? error.nodePath : stepPath,
      at: typeof error.at === 'string' ? error.at : new Date().toISOString(),
      ...(typeof error.code === 'string' ? { code: error.code } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
  }

  return {
    category: isCancellationLikeError(error) ? 'Cancellation' : 'ActionError',
    message: error instanceof Error ? error.message : String(error),
    nodePath: stepPath,
    at: new Date().toISOString(),
  };
}

function isRuntimeErrorLike(value: unknown): value is RuntimeErrorLike {
  return value !== null
    && typeof value === 'object'
    && typeof (value as Record<string, unknown>).category === 'string'
    && typeof (value as Record<string, unknown>).message === 'string';
}

function isUncatchableWorkflowError(error: unknown): boolean {
  return isCancellationLikeError(error) || isInterpreterCorruptionLikeError(error);
}

function isCancellationRuntimeError(error: RuntimeErrorLike): boolean {
  return error.category === 'Cancellation';
}

function isInterpreterCorruptionRuntimeError(error: RuntimeErrorLike): boolean {
  return error.category === 'InterpreterCorruption';
}

function isCancellationLikeError(error: unknown): boolean {
  if (isRuntimeErrorLike(error) && error.category === 'Cancellation') {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : '';
  const message = typeof record.message === 'string' ? record.message : '';
  return /cancel(l)?ed/i.test(name) || /cancel(l)?ed/i.test(message);
}

function isInterpreterCorruptionLikeError(error: unknown): boolean {
  return isRuntimeErrorLike(error) && error.category === 'InterpreterCorruption';
}

function createInterpreterCorruptionError(message: string, details?: unknown): RuntimeErrorLike {
  return {
    category: 'InterpreterCorruption',
    message,
    nodePath: 'interpreter',
    at: new Date().toISOString(),
    ...(details === undefined ? {} : { details }),
  };
}

function resolveStepRetryPolicy(step: {
  retry?: RetryPolicy;
}): RetryPolicy | null {
  return step.retry ?? null;
}

function resolveStepOnErrorPolicy(step: {
  onError?: OnErrorPolicy;
  config?: unknown;
}): 'continue' | 'fail' {
  if (step.onError?.policy === 'continue' || step.onError?.policy === 'fail') {
    return step.onError.policy;
  }
  if (isRecord(step.config) && isRecord(step.config.onError)) {
    const policy = step.config.onError.policy;
    if (policy === 'continue' || policy === 'fail') {
      return policy;
    }
  }
  return 'fail';
}

function shouldRetry(error: RuntimeErrorLike, policy: RetryPolicy | null, attempt: number): boolean {
  if (!policy) {
    return false;
  }
  if (attempt >= policy.maxAttempts) {
    return false;
  }
  if (Array.isArray(policy.retryOn) && policy.retryOn.length > 0 && !policy.retryOn.includes(error.category)) {
    return false;
  }
  return true;
}

function getRetryBackoffMs(policy: RetryPolicy, attempt: number): number {
  const multiplier = policy.backoffMultiplier ?? 2;
  const rawBackoff = policy.backoffMs * Math.pow(multiplier, Math.max(0, attempt - 1));
  const bounded = policy.maxDelayMs ? Math.min(rawBackoff, policy.maxDelayMs) : rawBackoff;
  return Math.max(0, Math.floor(bounded));
}

function routeTryCatchFailure(input: {
  state: WorkflowRuntimeV2InterpreterState;
  definition: WorkflowDefinition;
  failedStepPath: string;
  runtimeError: RuntimeErrorLike;
}): WorkflowRuntimeV2InterpreterState | null {
  const match = /^root\.steps\[(\d+)\]\.try\.steps\[\d+\](?:\..+)?$/.exec(input.failedStepPath);
  if (!match) {
    return null;
  }
  const parentIndex = Number(match[1]);
  const parentStep = input.definition.steps[parentIndex];
  if (!parentStep || parentStep.type !== 'control.tryCatch') {
    return null;
  }
  const tryCatchStep = parentStep as TryCatchBlock;
  const tryPathPrefix = `root.steps[${parentIndex}].try.steps`;
  const nextFrames = [...input.state.frames];
  while (nextFrames.length > 0 && nextFrames[nextFrames.length - 1].path.startsWith(tryPathPrefix)) {
    nextFrames.pop();
  }

  let nextState: WorkflowRuntimeV2InterpreterState = {
    ...input.state,
    frames: nextFrames,
  };
  if (tryCatchStep.captureErrorAs) {
    nextState = assignToScopePath(nextState, `vars.${tryCatchStep.captureErrorAs}`, input.runtimeError);
  }
  if (tryCatchStep.catch.length > 0) {
    nextState = pushWorkflowRuntimeV2SequenceFrame(nextState, {
      path: `root.steps[${parentIndex}].catch.steps`,
      totalSteps: tryCatchStep.catch.length,
    });
  }
  return nextState;
}
