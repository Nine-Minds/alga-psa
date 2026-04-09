import { condition, continueAsNew, defineQuery, defineSignal, executeChild, proxyActivities, setHandler, sleep } from '@temporalio/workflow';
import {
  WORKFLOW_RUNTIME_V2_EVENT_SIGNAL,
  WORKFLOW_RUNTIME_V2_HUMAN_TASK_SIGNAL,
  WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE,
  type WorkflowRuntimeV2TemporalRunInput,
} from '@alga-psa/workflows/lib/workflowRuntimeV2Temporal';
import type { EventWaitFilter, Expr, ForEachBlock, IfBlock } from '@alga-psa/workflows/runtime';
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
  startWorkflowRuntimeV2ChildRun(input: {
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
  }>;
  projectWorkflowRuntimeV2TimeWaitStart(input: {
    runId: string;
    stepPath: string;
    dueAt: string;
    payload: {
      mode: 'duration' | 'until';
      durationMs: number | null;
      dueAt: string;
    };
  }): Promise<{ waitId: string }>;
  projectWorkflowRuntimeV2TimeWaitResolved(input: {
    waitId: string;
    runId: string;
    status: 'RESOLVED' | 'CANCELED';
  }): Promise<void>;
  projectWorkflowRuntimeV2EventWaitStart(input: {
    runId: string;
    stepPath: string;
    eventName: string;
    correlationKey: string | null;
    timeoutAt: string | null;
    payload: {
      eventName: string;
      correlationKey: string | null;
      filters: EventWaitFilter[];
      timeoutAt: string | null;
    };
  }): Promise<{ waitId: string }>;
  projectWorkflowRuntimeV2EventWaitResolved(input: {
    waitId: string;
    runId: string;
    status: 'RESOLVED' | 'CANCELED';
    matchedEventId?: string | null;
  }): Promise<void>;
  startWorkflowRuntimeV2HumanTaskWait(input: {
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
  }>;
  resolveWorkflowRuntimeV2HumanTaskWait(input: {
    waitId: string;
    runId: string;
    status: 'RESOLVED' | 'CANCELED';
    payload: Record<string, unknown>;
  }): Promise<void>;
  validateWorkflowRuntimeV2HumanTaskResponse(input: {
    tenantId: string | null;
    taskType: string;
    eventName: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
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

type ParsedTimeWaitConfig =
  | {
      mode: 'duration';
      durationMs: number;
      assign?: Record<string, Expr>;
    }
  | {
      mode: 'until';
      until: Expr;
      assign?: Record<string, Expr>;
    };

type ParsedEventWaitConfig = {
  eventName: string;
  correlationKey: Expr;
  filters: EventWaitFilter[];
  timeoutMs: number | null;
  assign?: Record<string, Expr>;
};

type WorkflowRuntimeV2EventSignalPayload = {
  eventId: string | null;
  eventName: string;
  correlationKey: string | null;
  payload: Record<string, unknown>;
  receivedAt: string;
};

const workflowRuntimeV2EventSignal = defineSignal<[WorkflowRuntimeV2EventSignalPayload]>(WORKFLOW_RUNTIME_V2_EVENT_SIGNAL);

type ParsedHumanTaskConfig = {
  taskType: string;
  title: Expr;
  description?: Expr;
  contextData?: Record<string, Expr>;
  assign?: Record<string, Expr>;
};

type WorkflowRuntimeV2HumanTaskSignalPayload = {
  taskId: string;
  eventName?: string | null;
  payload?: Record<string, unknown> | null;
};

const workflowRuntimeV2HumanTaskSignal = defineSignal<[WorkflowRuntimeV2HumanTaskSignalPayload]>(WORKFLOW_RUNTIME_V2_HUMAN_TASK_SIGNAL);

type WorkflowRuntimeV2CurrentWait = {
  type: 'time.wait' | 'event.wait' | 'human.task';
  stepPath: string;
  descriptor: Record<string, unknown>;
};

const workflowRuntimeV2CurrentStepQuery = defineQuery<{
  runId: string;
  currentStepPath: string | null;
}>('workflowRuntimeV2CurrentStep');
const workflowRuntimeV2CurrentWaitQuery = defineQuery<WorkflowRuntimeV2CurrentWait | null>('workflowRuntimeV2CurrentWait');
const workflowRuntimeV2InterpreterSummaryQuery = defineQuery<{
  runId: string;
  stepCount: number;
  currentStepPath: string | null;
  frameDepth: number;
}>('workflowRuntimeV2InterpreterSummary');

export type WorkflowRuntimeV2RunWorkflowResult = {
  scopes: WorkflowRuntimeV2ScopeState;
};

export async function workflowRuntimeV2RunWorkflow(
  input: WorkflowRuntimeV2RunWorkflowInput
): Promise<WorkflowRuntimeV2RunWorkflowResult> {
  const pendingEventSignals: WorkflowRuntimeV2EventSignalPayload[] = [];
  setHandler(workflowRuntimeV2EventSignal, (signal) => {
    pendingEventSignals.push(normalizeEventSignalPayload(signal));
  });
  const pendingHumanTaskSignals: WorkflowRuntimeV2HumanTaskSignalPayload[] = [];
  setHandler(workflowRuntimeV2HumanTaskSignal, (signal) => {
    pendingHumanTaskSignals.push(normalizeHumanTaskSignalPayload(signal));
  });
  let queryCurrentStepPath: string | null = null;
  let queryStepCount = 0;
  let queryFrameDepth = 0;
  let queryCurrentWait: WorkflowRuntimeV2CurrentWait | null = null;
  setHandler(workflowRuntimeV2CurrentStepQuery, () => ({
    runId: input.runId,
    currentStepPath: queryCurrentStepPath,
  }));
  setHandler(workflowRuntimeV2CurrentWaitQuery, () => queryCurrentWait);
  setHandler(workflowRuntimeV2InterpreterSummaryQuery, () => ({
    runId: input.runId,
    stepCount: queryStepCount,
    currentStepPath: queryCurrentStepPath,
    frameDepth: queryFrameDepth,
  }));

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
  queryStepCount = stepCount;
  queryFrameDepth = state.frames.length;
  queryCurrentStepPath = state.currentStepPath;
  const maybeContinueAsNew = async (): Promise<void> => {
    if (stepCount <= 0 || stepCount % CONTINUE_AS_NEW_EVERY_STEPS !== 0) {
      return;
    }
    const checkpoint = createWorkflowRuntimeV2InterpreterCheckpoint({
      state,
      stepCount,
    });
    await continueAsNew<typeof workflowRuntimeV2RunWorkflow>({
      ...input,
      checkpoint,
    });
  };

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
      return {
        scopes: state.scopes,
      };
    }

    state = {
      ...state,
      currentStepPath: current.path,
    };
    queryCurrentStepPath = state.currentStepPath;
    queryFrameDepth = state.frames.length;

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
        return {
          scopes: state.scopes,
        };
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
        queryStepCount = stepCount;
        await maybeContinueAsNew();
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
        queryStepCount = stepCount;
        await maybeContinueAsNew();
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
        queryStepCount = stepCount;
        await maybeContinueAsNew();
        continue;
      }

      if (current.step.type === 'control.callWorkflow') {
        const callWorkflowStep = current.step as {
          workflowId: string;
          workflowVersion: number;
          inputMapping?: Record<string, Expr>;
          outputMapping?: Record<string, Expr>;
          retry?: RetryPolicy;
        };
        const childPayload = await evaluateExpressionMapping(
          callWorkflowStep.inputMapping ?? {},
          state.scopes
        );
        const childStart = await activities.startWorkflowRuntimeV2ChildRun({
          parentRunId: state.scopes.system.runId,
          parentStepPath: current.path,
          tenantId: state.scopes.system.tenantId,
          workflowId: callWorkflowStep.workflowId,
          workflowVersion: callWorkflowStep.workflowVersion,
          payload: childPayload,
        });

        const retryPolicy = resolveStepRetryPolicy(callWorkflowStep);
        let attempt = 1;
        while (true) {
          try {
            const childResult = await executeChild(workflowRuntimeV2RunWorkflow, {
              workflowId: childStart.temporalWorkflowId,
              taskQueue: WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE,
              args: [{
                runId: childStart.childRunId,
                tenantId: state.scopes.system.tenantId,
                workflowId: callWorkflowStep.workflowId,
                workflowVersion: callWorkflowStep.workflowVersion,
                triggerType: null,
                executionKey: `${input.executionKey}:child:${childStart.childRunId}`,
              }],
            });
            if (callWorkflowStep.outputMapping) {
              state = await applyCallWorkflowOutputMapping(state, callWorkflowStep.outputMapping, childResult.scopes);
            }
            break;
          } catch (error) {
            const childError = createChildWorkflowRuntimeError(current.path, {
              workflowId: callWorkflowStep.workflowId,
              workflowVersion: callWorkflowStep.workflowVersion,
              childRunId: childStart.childRunId,
              rootRunId: childStart.rootRunId,
              cause: error instanceof Error ? error.message : String(error),
            });
            if (shouldRetry(childError, retryPolicy, attempt)) {
              const backoffMs = getRetryBackoffMs(retryPolicy!, attempt);
              attempt += 1;
              await sleep(backoffMs);
              continue;
            }
            throw childError;
          }
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
        queryStepCount = stepCount;
        await maybeContinueAsNew();
        continue;
      }

      if (current.step.type === 'time.wait') {
        const timeWaitStep = current.step as {
          config?: unknown;
        };
        const config = parseTimeWaitConfig(timeWaitStep.config, current.path);
        const dueAt = await resolveTimeWaitDueAt(config, state.scopes, current.path);
        const waitProjection = await activities.projectWorkflowRuntimeV2TimeWaitStart({
          runId: input.runId,
          stepPath: current.path,
          dueAt,
          payload: {
            mode: config.mode,
            durationMs: config.mode === 'duration' ? config.durationMs : null,
            dueAt,
          },
        });
        queryCurrentWait = {
          type: 'time.wait',
          stepPath: current.path,
          descriptor: {
            dueAt,
            mode: config.mode,
          },
        };

        const dueAtMs = new Date(dueAt).getTime();
        const nowMs = Date.now();
        if (Number.isFinite(dueAtMs) && dueAtMs > nowMs) {
          await sleep(dueAtMs - nowMs);
        }

        await activities.projectWorkflowRuntimeV2TimeWaitResolved({
          waitId: waitProjection.waitId,
          runId: input.runId,
          status: 'RESOLVED',
        });
        queryCurrentWait = null;

        state = assignToScopePath(state, 'vars.timeWait', {
          mode: config.mode,
          dueAt,
          resumedAt: new Date().toISOString(),
        });
        if (config.assign) {
          state = await applyExpressionAssignments(state, config.assign);
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
        queryStepCount = stepCount;
        await maybeContinueAsNew();
        continue;
      }

      if (current.step.type === 'event.wait') {
        const eventWaitStep = current.step as {
          config?: unknown;
        };
        const config = parseEventWaitConfig(eventWaitStep.config, current.path);
        const correlationKey = await resolveEventWaitCorrelationKey(config, state.scopes);
        const timeoutAt = resolveEventWaitTimeoutAt(config);
        const waitProjection = await activities.projectWorkflowRuntimeV2EventWaitStart({
          runId: input.runId,
          stepPath: current.path,
          eventName: config.eventName,
          correlationKey,
          timeoutAt,
          payload: {
            eventName: config.eventName,
            correlationKey,
            filters: config.filters,
            timeoutAt,
          },
        });
        queryCurrentWait = {
          type: 'event.wait',
          stepPath: current.path,
          descriptor: {
            eventName: config.eventName,
            correlationKey,
            timeoutAt,
          },
        };

        const matchedSignal = await awaitMatchingEventSignal({
          descriptor: {
            eventName: config.eventName,
            correlationKey,
            filters: config.filters,
          },
          timeoutAt,
          pendingSignals: pendingEventSignals,
        });

        if (!matchedSignal) {
          await activities.projectWorkflowRuntimeV2EventWaitResolved({
            waitId: waitProjection.waitId,
            runId: input.runId,
            status: 'RESOLVED',
            matchedEventId: null,
          });
          queryCurrentWait = null;
          throw createTimeoutRuntimeError(current.path, config.eventName, correlationKey, timeoutAt);
        }

        await activities.projectWorkflowRuntimeV2EventWaitResolved({
          waitId: waitProjection.waitId,
          runId: input.runId,
          status: 'RESOLVED',
          matchedEventId: matchedSignal.eventId,
        });
        queryCurrentWait = null;

        state = assignToScopePath(state, 'vars.event', matchedSignal.payload);
        state = assignToScopePath(state, 'vars.eventName', matchedSignal.eventName);
        if (config.assign) {
          state = await applyExpressionAssignments(state, config.assign);
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
        queryStepCount = stepCount;
        await maybeContinueAsNew();
        continue;
      }

      if (current.step.type === 'human.task') {
        const humanTaskStep = current.step as {
          config?: unknown;
        };
        const config = parseHumanTaskConfig(humanTaskStep.config, current.path);
        const titleValue = await evaluateExpression(config.title.$expr, buildWorkflowRuntimeV2ExpressionContext(state.scopes));
        const descriptionValue = config.description
          ? await evaluateExpression(config.description.$expr, buildWorkflowRuntimeV2ExpressionContext(state.scopes))
          : null;
        const contextData = config.contextData
          ? await evaluateExpressionMapping(config.contextData, state.scopes)
          : {};

        const createdTask = await activities.startWorkflowRuntimeV2HumanTaskWait({
          runId: input.runId,
          stepPath: current.path,
          tenantId: state.scopes.system.tenantId,
          taskType: config.taskType,
          title: String(titleValue ?? ''),
          description: descriptionValue === null || descriptionValue === undefined ? null : String(descriptionValue),
          contextData,
        });
        queryCurrentWait = {
          type: 'human.task',
          stepPath: current.path,
          descriptor: {
            taskId: createdTask.taskId,
            taskType: config.taskType,
          },
        };

        const matchedSignal = await awaitHumanTaskSignal({
          taskId: createdTask.taskId,
          pendingSignals: pendingHumanTaskSignals,
        });

        const responsePayload = isRecord(matchedSignal.payload) ? matchedSignal.payload : {};
        const responseEventName = matchedSignal.eventName ?? createdTask.eventName;
        await activities.validateWorkflowRuntimeV2HumanTaskResponse({
          tenantId: state.scopes.system.tenantId,
          taskType: config.taskType,
          eventName: responseEventName,
          payload: responsePayload,
        });
        await activities.resolveWorkflowRuntimeV2HumanTaskWait({
          waitId: createdTask.waitId,
          runId: input.runId,
          status: 'RESOLVED',
          payload: {
            taskId: createdTask.taskId,
            eventName: responseEventName,
            response: responsePayload,
          },
        });
        queryCurrentWait = null;

        state = assignToScopePath(state, 'vars.event', responsePayload);
        state = assignToScopePath(state, 'vars.eventName', responseEventName);
        if (config.assign) {
          state = await applyExpressionAssignments(state, config.assign);
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
        queryStepCount = stepCount;
        await maybeContinueAsNew();
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
              queryStepCount = stepCount;
              await maybeContinueAsNew();
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
        queryStepCount = stepCount;
        await maybeContinueAsNew();
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
      queryStepCount = stepCount;
      await maybeContinueAsNew();
    } catch (error) {
      queryCurrentWait = null;
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
        queryStepCount = stepCount;
        await maybeContinueAsNew();
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
        queryStepCount = stepCount;
        await maybeContinueAsNew();
        continue;
      }

      await activities.completeWorkflowRuntimeV2Run({ runId: input.runId, status: 'FAILED' });
      throw runtimeError;
    }

    await maybeContinueAsNew();
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

async function evaluateExpressionMapping(
  mapping: Record<string, Expr>,
  scopes: WorkflowRuntimeV2ScopeState
): Promise<Record<string, unknown>> {
  const context = buildWorkflowRuntimeV2ExpressionContext(scopes);
  const entries = await Promise.all(Object.entries(mapping).map(async ([key, value]) => {
    return [key, await evaluateExpression(value.$expr, context)] as const;
  }));
  return Object.fromEntries(entries);
}

async function applyExpressionAssignments(
  state: WorkflowRuntimeV2InterpreterState,
  assignments: Record<string, Expr>
): Promise<WorkflowRuntimeV2InterpreterState> {
  let nextState = state;
  for (const [path, expr] of Object.entries(assignments)) {
    const value = await evaluateExpression(expr.$expr, buildWorkflowRuntimeV2ExpressionContext(nextState.scopes));
    nextState = assignToScopePath(nextState, path, value);
  }
  return nextState;
}

async function applyCallWorkflowOutputMapping(
  parentState: WorkflowRuntimeV2InterpreterState,
  outputMapping: Record<string, Expr>,
  childScopes: WorkflowRuntimeV2ScopeState
): Promise<WorkflowRuntimeV2InterpreterState> {
  let state = parentState;
  const context = {
    ...buildWorkflowRuntimeV2ExpressionContext(parentState.scopes),
    childRun: {
      payload: childScopes.payload,
      vars: childScopes.workflow,
      local: childScopes.lexical[childScopes.lexical.length - 1] ?? {},
      system: childScopes.system,
      meta: {
        runId: childScopes.system.runId,
        workflowId: childScopes.system.workflowId,
        workflowVersion: childScopes.system.workflowVersion,
        tenantId: childScopes.system.tenantId,
        definitionHash: childScopes.system.definitionHash,
        runtimeSemanticsVersion: childScopes.system.runtimeSemanticsVersion,
      },
    },
  };

  for (const [path, expr] of Object.entries(outputMapping)) {
    const value = await evaluateExpression(expr.$expr, context);
    state = assignToScopePath(state, path, value);
  }

  return state;
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

function parseTimeWaitConfig(config: unknown, stepPath: string): ParsedTimeWaitConfig {
  if (!isRecord(config)) {
    throw createValidationRuntimeError(stepPath, 'time.wait config is required');
  }

  const mode = config.mode;
  if (mode !== 'duration' && mode !== 'until') {
    throw createValidationRuntimeError(stepPath, 'time.wait mode must be "duration" or "until"');
  }

  if (mode === 'duration') {
    if (typeof config.durationMs !== 'number' || !Number.isFinite(config.durationMs) || config.durationMs <= 0) {
      throw createValidationRuntimeError(stepPath, 'time.wait duration mode requires durationMs > 0');
    }
  } else if (!isExpr(config.until)) {
    throw createValidationRuntimeError(stepPath, 'time.wait until mode requires an until expression');
  }

  if (config.assign !== undefined && !isExprRecord(config.assign)) {
    throw createValidationRuntimeError(stepPath, 'time.wait assign must be an expression map');
  }

  if (mode === 'duration') {
    return {
      mode: 'duration',
      durationMs: config.durationMs as number,
      ...(isExprRecord(config.assign) ? { assign: config.assign } : {}),
    };
  }

  return {
    mode: 'until',
    until: config.until as Expr,
    ...(isExprRecord(config.assign) ? { assign: config.assign } : {}),
  };
}

async function resolveTimeWaitDueAt(
  config: ParsedTimeWaitConfig,
  scopes: WorkflowRuntimeV2ScopeState,
  stepPath: string
): Promise<string> {
  if (config.mode === 'duration') {
    return new Date(Date.now() + config.durationMs).toISOString();
  }

  const value = await evaluateExpression(config.until.$expr, buildWorkflowRuntimeV2ExpressionContext(scopes));
  const dueAt = new Date(String(value ?? ''));
  if (!Number.isFinite(dueAt.getTime())) {
    throw createValidationRuntimeError(stepPath, 'time.wait until expression did not resolve to a valid date/time');
  }
  return dueAt.toISOString();
}

function parseEventWaitConfig(config: unknown, stepPath: string): ParsedEventWaitConfig {
  if (!isRecord(config)) {
    throw createValidationRuntimeError(stepPath, 'event.wait config is required');
  }
  if (typeof config.eventName !== 'string' || config.eventName.trim().length === 0) {
    throw createValidationRuntimeError(stepPath, 'event.wait requires eventName');
  }
  if (!isExpr(config.correlationKey)) {
    throw createValidationRuntimeError(stepPath, 'event.wait requires correlationKey expression');
  }
  if (config.filters !== undefined && !isEventWaitFilterArray(config.filters)) {
    throw createValidationRuntimeError(stepPath, 'event.wait filters must be a valid filter array');
  }
  if (config.timeoutMs !== undefined && (!isFinitePositiveNumber(config.timeoutMs) || config.timeoutMs <= 0)) {
    throw createValidationRuntimeError(stepPath, 'event.wait timeoutMs must be a positive number');
  }
  if (config.assign !== undefined && !isExprRecord(config.assign)) {
    throw createValidationRuntimeError(stepPath, 'event.wait assign must be an expression map');
  }

  return {
    eventName: config.eventName,
    correlationKey: config.correlationKey,
    filters: Array.isArray(config.filters) ? config.filters : [],
    timeoutMs: typeof config.timeoutMs === 'number' ? config.timeoutMs : null,
    ...(isExprRecord(config.assign) ? { assign: config.assign } : {}),
  };
}

async function resolveEventWaitCorrelationKey(
  config: ParsedEventWaitConfig,
  scopes: WorkflowRuntimeV2ScopeState
): Promise<string | null> {
  const value = await evaluateExpression(
    config.correlationKey.$expr,
    buildWorkflowRuntimeV2ExpressionContext(scopes)
  );
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

function resolveEventWaitTimeoutAt(config: ParsedEventWaitConfig): string | null {
  if (!config.timeoutMs) {
    return null;
  }
  return new Date(Date.now() + config.timeoutMs).toISOString();
}

async function awaitMatchingEventSignal(input: {
  descriptor: {
    eventName: string;
    correlationKey: string | null;
    filters: EventWaitFilter[];
  };
  timeoutAt: string | null;
  pendingSignals: WorkflowRuntimeV2EventSignalPayload[];
}): Promise<WorkflowRuntimeV2EventSignalPayload | null> {
  const tryConsume = () => consumeMatchingEventSignal(input.pendingSignals, input.descriptor);
  const immediate = tryConsume();
  if (immediate) {
    return immediate;
  }

  const timeoutMs = resolveRemainingTimeoutMs(input.timeoutAt);
  if (timeoutMs !== null && timeoutMs <= 0) {
    return null;
  }

  const signaled = timeoutMs === null
    ? await condition(() => findMatchingEventSignalIndex(input.pendingSignals, input.descriptor) >= 0)
    : await condition(
        () => findMatchingEventSignalIndex(input.pendingSignals, input.descriptor) >= 0,
        timeoutMs
      );
  if (!signaled) {
    return null;
  }
  return tryConsume();
}

function consumeMatchingEventSignal(
  pendingSignals: WorkflowRuntimeV2EventSignalPayload[],
  descriptor: { eventName: string; correlationKey: string | null; filters: EventWaitFilter[] }
): WorkflowRuntimeV2EventSignalPayload | null {
  const index = findMatchingEventSignalIndex(pendingSignals, descriptor);
  if (index < 0) {
    return null;
  }
  const [signal] = pendingSignals.splice(index, 1);
  return signal ?? null;
}

function findMatchingEventSignalIndex(
  pendingSignals: WorkflowRuntimeV2EventSignalPayload[],
  descriptor: { eventName: string; correlationKey: string | null; filters: EventWaitFilter[] }
): number {
  return pendingSignals.findIndex((signal) => isMatchingEventSignal(signal, descriptor));
}

function isMatchingEventSignal(
  signal: WorkflowRuntimeV2EventSignalPayload,
  descriptor: { eventName: string; correlationKey: string | null; filters: EventWaitFilter[] }
): boolean {
  if (signal.eventName !== descriptor.eventName) {
    return false;
  }
  if (descriptor.correlationKey !== null && signal.correlationKey !== descriptor.correlationKey) {
    return false;
  }
  return descriptor.filters.every((filter) => evaluateEventWaitFilter(signal.payload, filter));
}

function evaluateEventWaitFilter(payload: Record<string, unknown>, filter: EventWaitFilter): boolean {
  const current = getEventPayloadValue(payload, filter.path);
  switch (filter.op) {
    case '=':
      return current === filter.value;
    case '!=':
      return current !== filter.value;
    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(current as never);
    case 'not_in':
      return Array.isArray(filter.value) && !filter.value.includes(current as never);
    case 'exists':
      return current !== undefined;
    case 'not_exists':
      return current === undefined;
    case '>':
      return typeof current === 'number' && typeof filter.value === 'number' && current > filter.value;
    case '>=':
      return typeof current === 'number' && typeof filter.value === 'number' && current >= filter.value;
    case '<':
      return typeof current === 'number' && typeof filter.value === 'number' && current < filter.value;
    case '<=':
      return typeof current === 'number' && typeof filter.value === 'number' && current <= filter.value;
    case 'contains':
      return typeof current === 'string' && typeof filter.value === 'string' && current.includes(filter.value);
    case 'starts_with':
      return typeof current === 'string' && typeof filter.value === 'string' && current.startsWith(filter.value);
    case 'ends_with':
      return typeof current === 'string' && typeof filter.value === 'string' && current.endsWith(filter.value);
    default:
      return false;
  }
}

function getEventPayloadValue(payload: Record<string, unknown>, path: string): unknown {
  const normalized = path.replace(/^\$?\./, '');
  const parts = normalized.split('.').filter(Boolean);
  let cursor: unknown = payload;
  for (const part of parts) {
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

function resolveRemainingTimeoutMs(timeoutAt: string | null): number | null {
  if (!timeoutAt) {
    return null;
  }
  const timeoutAtMs = new Date(timeoutAt).getTime();
  if (!Number.isFinite(timeoutAtMs)) {
    return 0;
  }
  return Math.max(0, timeoutAtMs - Date.now());
}

function parseHumanTaskConfig(config: unknown, stepPath: string): ParsedHumanTaskConfig {
  if (!isRecord(config)) {
    throw createValidationRuntimeError(stepPath, 'human.task config is required');
  }
  if (typeof config.taskType !== 'string' || config.taskType.trim().length === 0) {
    throw createValidationRuntimeError(stepPath, 'human.task requires taskType');
  }
  if (!isExpr(config.title)) {
    throw createValidationRuntimeError(stepPath, 'human.task requires title expression');
  }
  if (config.description !== undefined && !isExpr(config.description)) {
    throw createValidationRuntimeError(stepPath, 'human.task description must be an expression');
  }
  if (config.contextData !== undefined && !isExprRecord(config.contextData)) {
    throw createValidationRuntimeError(stepPath, 'human.task contextData must be an expression map');
  }
  if (config.assign !== undefined && !isExprRecord(config.assign)) {
    throw createValidationRuntimeError(stepPath, 'human.task assign must be an expression map');
  }

  return {
    taskType: config.taskType,
    title: config.title,
    ...(isExpr(config.description) ? { description: config.description } : {}),
    ...(isExprRecord(config.contextData) ? { contextData: config.contextData } : {}),
    ...(isExprRecord(config.assign) ? { assign: config.assign } : {}),
  };
}

async function awaitHumanTaskSignal(input: {
  taskId: string;
  pendingSignals: WorkflowRuntimeV2HumanTaskSignalPayload[];
}): Promise<WorkflowRuntimeV2HumanTaskSignalPayload> {
  const tryConsume = () => consumeHumanTaskSignal(input.pendingSignals, input.taskId);
  const immediate = tryConsume();
  if (immediate) {
    return immediate;
  }

  await condition(() => findHumanTaskSignalIndex(input.pendingSignals, input.taskId) >= 0);
  return tryConsume() ?? {
    taskId: input.taskId,
    eventName: 'HUMAN_TASK_COMPLETED',
    payload: {},
  };
}

function consumeHumanTaskSignal(
  pendingSignals: WorkflowRuntimeV2HumanTaskSignalPayload[],
  taskId: string
): WorkflowRuntimeV2HumanTaskSignalPayload | null {
  const index = findHumanTaskSignalIndex(pendingSignals, taskId);
  if (index < 0) {
    return null;
  }
  const [signal] = pendingSignals.splice(index, 1);
  return signal ?? null;
}

function findHumanTaskSignalIndex(
  pendingSignals: WorkflowRuntimeV2HumanTaskSignalPayload[],
  taskId: string
): number {
  return pendingSignals.findIndex((signal) => signal.taskId === taskId);
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

function createChildWorkflowRuntimeError(stepPath: string, details: Record<string, unknown>): RuntimeErrorLike {
  return {
    category: 'ChildWorkflowError',
    message: 'Child workflow execution failed',
    nodePath: stepPath,
    at: new Date().toISOString(),
    details,
  };
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

function createValidationRuntimeError(stepPath: string, message: string): RuntimeErrorLike {
  return {
    category: 'ValidationError',
    message,
    nodePath: stepPath,
    at: new Date().toISOString(),
  };
}

function createTimeoutRuntimeError(
  stepPath: string,
  eventName: string,
  correlationKey: string | null,
  timeoutAt: string | null
): RuntimeErrorLike {
  return {
    category: 'TimeoutError',
    message: `event.wait timed out waiting for ${eventName}`,
    nodePath: stepPath,
    at: new Date().toISOString(),
    details: {
      eventName,
      correlationKey,
      timeoutAt,
    },
  };
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.$expr === 'string';
}

function isExprRecord(value: unknown): value is Record<string, Expr> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((entry) => isExpr(entry));
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEventWaitFilterArray(value: unknown): value is EventWaitFilter[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((entry) => {
    if (!isRecord(entry)) {
      return false;
    }
    if (typeof entry.path !== 'string' || typeof entry.op !== 'string') {
      return false;
    }
    return true;
  });
}

function normalizeEventSignalPayload(signal: WorkflowRuntimeV2EventSignalPayload): WorkflowRuntimeV2EventSignalPayload {
  return {
    eventId: typeof signal.eventId === 'string' ? signal.eventId : null,
    eventName: signal.eventName,
    correlationKey: typeof signal.correlationKey === 'string' ? signal.correlationKey : null,
    payload: isRecord(signal.payload) ? signal.payload : {},
    receivedAt: typeof signal.receivedAt === 'string' ? signal.receivedAt : new Date().toISOString(),
  };
}

function normalizeHumanTaskSignalPayload(signal: WorkflowRuntimeV2HumanTaskSignalPayload): WorkflowRuntimeV2HumanTaskSignalPayload {
  return {
    taskId: typeof signal.taskId === 'string' ? signal.taskId : '',
    eventName: typeof signal.eventName === 'string' ? signal.eventName : 'HUMAN_TASK_COMPLETED',
    payload: isRecord(signal.payload) ? signal.payload : {},
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
