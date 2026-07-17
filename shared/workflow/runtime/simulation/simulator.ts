/**
 * Workflow simulation engine.
 *
 * Executes a WorkflowDefinition in-process with zero side effects:
 * - Control flow (`control.if` / `control.forEach` / `control.tryCatch` /
 *   `control.return`) and expression evaluation mirror the Temporal
 *   interpreter (`ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts`);
 *   contract tests compare the two on fixture workflows.
 * - Pure node steps (`transform.*`, `state.set`, `email.*`) execute through the
 *   REAL registered node handlers so their semantics cannot drift — only their
 *   `actions.call` is stubbed.
 * - `action.call` steps evaluate their real input mapping, then return
 *   (in precedence order) a caller-supplied fixture, a schema-shaped
 *   placeholder derived from the action's output schema, or `{}` with a
 *   warning in the trace.
 * - Waits (`event.wait` / `time.wait` / `human.task`) and
 *   `control.callWorkflow` short-circuit: they resume with a fixture when one
 *   is provided, otherwise the run ends with status `paused-at-wait`.
 */

import { compileExpression } from '../expressionEngine';
import { getNodeTypeRegistry } from '../registries/nodeTypeRegistry';
import { getActionRegistryV2 } from '../registries/actionRegistry';
import { resolveActionCallOutputSchema } from '../actions/actionOutputSchemaResolver';
import { resolveInputMapping, type SecretResolver } from '../utils/mappingResolver';
import { buildSampleFromJsonSchema } from './samplePayload';
import type {
  Envelope,
  Expr,
  ForEachBlock,
  IfBlock,
  InputMapping,
  Step,
  TryCatchBlock,
  WorkflowDefinition,
} from '../types';

export type WorkflowSimulationOutcome = 'executed' | 'stubbed' | 'skipped' | 'error' | 'would-wait';

export type WorkflowSimulationTraceEntry = {
  stepId: string;
  /** Interpreter-style step path, e.g. root.steps[1].then.steps[0] */
  path: string;
  type: string;
  outcome: WorkflowSimulationOutcome;
  evaluatedInput?: unknown;
  output?: unknown;
  branchTaken?: 'then' | 'else';
  savedAs?: string;
  /** Set when an error was absorbed instead of failing the run. */
  handledBy?: 'onError-continue' | 'tryCatch' | 'forEach-continue';
  message?: string;
};

export type WorkflowSimulationInvocation = {
  stepId: string;
  path: string;
  actionId: string;
  version: number;
  /** The action input after evaluating the real input mapping. */
  input: unknown;
  /** Where the stubbed output came from. */
  outputSource: 'fixture' | 'schema' | 'empty';
};

export type WorkflowSimulationIssue = { stepId?: string; path?: string; message: string };

export type WorkflowSimulationResult = {
  status: 'completed' | 'paused-at-wait' | 'failed';
  trace: WorkflowSimulationTraceEntry[];
  finalVars: Record<string, unknown>;
  finalPayload: Record<string, unknown>;
  invocations: WorkflowSimulationInvocation[];
  errors: WorkflowSimulationIssue[];
  warnings: WorkflowSimulationIssue[];
};

/**
 * Fixtures are keyed by step id (preferred) or actionId.
 * - `action.call`: the fixture becomes the action output. A fixture of
 *   `{ $error: { message, category? } }` makes the stubbed action fail, which
 *   exercises retry/onError/tryCatch paths.
 * - `event.wait` / `human.task`: the fixture is the resume event payload.
 * - `time.wait`: any fixture value resumes the wait immediately.
 * - `control.callWorkflow`: a fixture of `{ payload?, vars? }` becomes the
 *   child run result used by `outputMapping`.
 */
export type WorkflowSimulationFixtures = Record<string, unknown>;

export type WorkflowSimulationOptions = {
  /** Total executed-step budget. Default 500, max 5000. */
  maxSteps?: number;
  /** Per-loop iteration cap. Default 100, max 1000. */
  maxForEachIterations?: number;
  /** Wall-clock budget in ms. Default 5000, max 30000. */
  maxDurationMs?: number;
  /** Serialized payload budget. Default 512KiB. */
  maxPayloadBytes?: number;
  tenantId?: string | null;
};

const DEFAULT_MAX_STEPS = 500;
const HARD_MAX_STEPS = 5000;
const DEFAULT_MAX_FOREACH_ITERATIONS = 100;
const HARD_MAX_FOREACH_ITERATIONS = 1000;
const DEFAULT_MAX_DURATION_MS = 5000;
const HARD_MAX_DURATION_MS = 30000;
const DEFAULT_MAX_PAYLOAD_BYTES = 512 * 1024;

type SimulationScopes = {
  payload: Record<string, unknown>;
  vars: Record<string, unknown>;
  lexical: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
  error: Record<string, unknown> | null;
  system: {
    runId: string;
    workflowId: string;
    workflowVersion: number;
    tenantId: string | null;
    definitionHash: string | null;
    runtimeSemanticsVersion: string | null;
  };
};

class SimulationStepError extends Error {
  constructor(
    message: string,
    readonly stepId: string,
    readonly path: string,
    readonly runtimeError: Record<string, unknown>,
    /** Guard-rail failures (step/time budgets) that no policy may absorb. */
    readonly fatal = false
  ) {
    super(message);
  }
}

/**
 * Failure-routing context, mirroring the interpreter: the nearest enclosing
 * tryCatch wins over everything; otherwise the nearest body-descended
 * forEach's onItemError policy decides whether execution continues with the
 * step after the failed one.
 */
type SequenceContext = {
  tryDepth: number;
  loopContinue: boolean;
};

class SimulationHalt extends Error {
  constructor(readonly status: 'completed' | 'paused-at-wait' | 'failed') {
    super(`simulation halted: ${status}`);
  }
}

export async function simulateWorkflowDefinition(params: {
  definition: WorkflowDefinition;
  payload?: unknown;
  fixtures?: WorkflowSimulationFixtures;
  options?: WorkflowSimulationOptions;
}): Promise<WorkflowSimulationResult> {
  const { definition } = params;
  const fixtures = params.fixtures ?? {};
  const maxSteps = clamp(params.options?.maxSteps, DEFAULT_MAX_STEPS, HARD_MAX_STEPS);
  const maxForEachIterations = clamp(
    params.options?.maxForEachIterations,
    DEFAULT_MAX_FOREACH_ITERATIONS,
    HARD_MAX_FOREACH_ITERATIONS
  );
  const maxDurationMs = clamp(params.options?.maxDurationMs, DEFAULT_MAX_DURATION_MS, HARD_MAX_DURATION_MS);
  const maxPayloadBytes = clamp(params.options?.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES, DEFAULT_MAX_PAYLOAD_BYTES);

  const trace: WorkflowSimulationTraceEntry[] = [];
  const invocations: WorkflowSimulationInvocation[] = [];
  const errors: WorkflowSimulationIssue[] = [];
  const warnings: WorkflowSimulationIssue[] = [];
  const startedAt = Date.now();
  let executedSteps = 0;

  const scopes: SimulationScopes = {
    payload: isRecord(params.payload) ? cloneRecord(params.payload) : {},
    vars: {},
    lexical: [],
    meta: {},
    error: null,
    system: {
      runId: 'simulated-run',
      workflowId: definition.id,
      workflowVersion: definition.version,
      tenantId: params.options?.tenantId ?? null,
      definitionHash: null,
      runtimeSemanticsVersion: null,
    },
  };

  const payloadBytes = safeByteLength(scopes.payload);
  if (payloadBytes > maxPayloadBytes) {
    return {
      status: 'failed',
      trace,
      finalVars: scopes.vars,
      finalPayload: scopes.payload,
      invocations,
      errors: [{ message: `Simulation payload exceeds ${maxPayloadBytes} bytes (${payloadBytes})` }],
      warnings,
    };
  }

  const warnedSecrets = new Set<string>();
  const secretResolver: SecretResolver = {
    async resolve(name: string): Promise<string> {
      if (!warnedSecrets.has(name)) {
        warnedSecrets.add(name);
        warnings.push({ message: `Secret "${name}" resolved to a placeholder value in simulation` });
      }
      return `[simulated-secret:${name}]`;
    },
  };

  const buildExpressionContext = (): Record<string, unknown> => {
    // Mirrors buildWorkflowRuntimeV2ExpressionContext in the Temporal interpreter.
    const lexicalTop = scopes.lexical[scopes.lexical.length - 1] ?? {};
    return {
      ...scopes.vars,
      ...lexicalTop,
      payload: scopes.payload,
      vars: scopes.vars,
      local: lexicalTop,
      system: scopes.system,
      meta: {
        ...scopes.meta,
        runId: scopes.system.runId,
        workflowId: scopes.system.workflowId,
        workflowVersion: scopes.system.workflowVersion,
        tenantId: scopes.system.tenantId,
        definitionHash: scopes.system.definitionHash,
        runtimeSemanticsVersion: scopes.system.runtimeSemanticsVersion,
      },
      error: scopes.error ?? null,
    };
  };

  const evaluateExpr = async (expr: Expr, stepId: string, path: string): Promise<unknown> => {
    try {
      return await compileExpression(expr).evaluate(buildExpressionContext());
    } catch (error) {
      throw stepError(stepId, path, 'ExpressionError', error instanceof Error ? error.message : String(error));
    }
  };

  const checkBudgets = (stepId: string, path: string): void => {
    executedSteps += 1;
    if (executedSteps > maxSteps) {
      throw stepError(stepId, path, 'QuotaExceeded', `Simulation exceeded the maximum of ${maxSteps} steps`, true);
    }
    if (Date.now() - startedAt > maxDurationMs) {
      throw stepError(stepId, path, 'TimeoutError', `Simulation exceeded the ${maxDurationMs}ms time budget`, true);
    }
  };

  const fixtureFor = (stepId: string, actionId?: string | null): unknown => {
    if (Object.prototype.hasOwnProperty.call(fixtures, stepId)) return fixtures[stepId];
    if (actionId && Object.prototype.hasOwnProperty.call(fixtures, actionId)) return fixtures[actionId];
    return undefined;
  };

  const stubActionOutput = (params2: {
    stepId: string;
    path: string;
    actionId: string;
    version: number;
    input: unknown;
  }): unknown => {
    const { stepId, path, actionId, version, input } = params2;
    const fixture = fixtureFor(stepId, actionId);
    if (fixture !== undefined) {
      if (isErrorFixture(fixture)) {
        invocations.push({ stepId, path, actionId, version, input, outputSource: 'fixture' });
        throw stepError(
          stepId,
          path,
          typeof fixture.$error.category === 'string' ? fixture.$error.category : 'ActionError',
          typeof fixture.$error.message === 'string' ? fixture.$error.message : `Fixture error for ${actionId}`
        );
      }
      invocations.push({ stepId, path, actionId, version, input, outputSource: 'fixture' });
      return fixture;
    }

    let schema: Record<string, unknown> | null = null;
    try {
      schema = resolveActionCallOutputSchema(getActionRegistryV2() as any, { actionId, version });
    } catch {
      schema = null;
    }
    if (schema) {
      invocations.push({ stepId, path, actionId, version, input, outputSource: 'schema' });
      return buildSampleFromJsonSchema(schema);
    }

    invocations.push({ stepId, path, actionId, version, input, outputSource: 'empty' });
    warnings.push({
      stepId,
      path,
      message: `No fixture or output schema for action ${actionId}@${version}; stubbed output is {}`,
    });
    return {};
  };

  const assignToScopePath = (saveAs: string, output: unknown): void => {
    // Mirrors assignToScopePath in the Temporal interpreter, including the
    // interpreter's behavior of writing meta.* assignments into vars.
    const normalized = normalizeAssignmentPath(saveAs);
    if (normalized.startsWith('payload.')) {
      setNestedValue(scopes.payload, normalized.slice('payload.'.length), output);
    } else if (normalized.startsWith('vars.')) {
      setNestedValue(scopes.vars, normalized.slice('vars.'.length), output);
    } else if (normalized.startsWith('local.')) {
      const top = scopes.lexical[scopes.lexical.length - 1];
      setNestedValue(top ?? scopes.vars, normalized.slice('local.'.length), output);
    } else if (normalized.startsWith('meta.')) {
      setNestedValue(scopes.vars, normalized.slice('meta.'.length), output);
    } else {
      setNestedValue(scopes.vars, normalized, output);
    }
  };

  const applyAssignExpressions = async (
    assign: Record<string, Expr>,
    stepId: string,
    path: string
  ): Promise<void> => {
    for (const [target, expr] of Object.entries(assign)) {
      assignToScopePath(target, await evaluateExpr(expr, stepId, path));
    }
  };

  const runNodeHandler = async (step: Step, path: string): Promise<void> => {
    const registry = getNodeTypeRegistry();
    const nodeType = registry.get(step.type);
    if (!nodeType) {
      throw stepError(step.id, path, 'ValidationError', `Unknown node type: ${step.type}`);
    }

    let parsedConfig: unknown;
    try {
      parsedConfig = nodeType.configSchema.parse((step as { config?: unknown }).config ?? {});
    } catch (error) {
      throw stepError(
        step.id,
        path,
        'ValidationError',
        `Invalid ${step.type} config: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const env: Envelope = {
      v: 1,
      run: {
        id: scopes.system.runId,
        workflowId: scopes.system.workflowId,
        workflowVersion: scopes.system.workflowVersion,
        startedAt: new Date(startedAt).toISOString(),
      },
      payload: scopes.payload,
      meta: scopes.meta as Envelope['meta'],
      vars: scopes.vars,
      error: scopes.error
        ? {
            name: typeof scopes.error.name === 'string' ? scopes.error.name : undefined,
            message: typeof scopes.error.message === 'string' ? scopes.error.message : String(scopes.error.message ?? ''),
            nodePath: typeof scopes.error.nodePath === 'string' ? scopes.error.nodePath : undefined,
            at: typeof scopes.error.at === 'string' ? scopes.error.at : new Date().toISOString(),
            data: scopes.error.data,
          }
        : undefined,
    };

    let result: Envelope | { type: 'wait' } | { type: 'return' };
    try {
      result = await nodeType.handler(env, parsedConfig, {
        runId: scopes.system.runId,
        stepPath: path,
        tenantId: scopes.system.tenantId,
        nowIso: () => new Date().toISOString(),
        secretResolver,
        actions: {
          call: async (actionId: string, version: number, args: unknown) => {
            return stubActionOutput({ stepId: step.id, path, actionId, version, input: args });
          },
        },
        publishWait: async () => {
          throw stepError(step.id, path, 'ValidationError', `Node step ${step.type} attempted to wait during simulation`);
        },
        resumeEvent: null,
        resumeError: null,
      });
    } catch (error) {
      if (error instanceof SimulationStepError || error instanceof SimulationHalt) throw error;
      // Node handlers throw both Error instances and structured runtime errors
      // ({ category, message, ... }) — surface the real message for both.
      const structured = isRecord(error) && typeof error.message === 'string' ? error : null;
      throw stepError(
        step.id,
        path,
        structured && typeof structured.category === 'string' ? structured.category : 'ActionError',
        structured ? String(structured.message) : error instanceof Error ? error.message : String(error)
      );
    }

    if ('type' in result) {
      if (result.type === 'wait') {
        trace.push({ stepId: step.id, path, type: step.type, outcome: 'would-wait' });
        warnings.push({ stepId: step.id, path, message: `Simulation paused: ${step.type} would wait` });
        throw new SimulationHalt('paused-at-wait');
      }
      throw new SimulationHalt('completed');
    }

    scopes.payload = isRecord(result.payload) ? (result.payload as Record<string, unknown>) : scopes.payload;
    scopes.vars = isRecord(result.vars) ? result.vars : scopes.vars;
    scopes.meta = isRecord(result.meta) ? (result.meta as Record<string, unknown>) : scopes.meta;
    scopes.error = result.error && typeof result.error === 'object' ? (result.error as Record<string, unknown>) : null;
    trace.push({ stepId: step.id, path, type: step.type, outcome: 'executed' });
  };

  const runActionCall = async (step: Step, path: string): Promise<void> => {
    const registry = getNodeTypeRegistry();
    const actionCallDef = registry.get('action.call');
    let config: {
      actionId: string;
      version: number;
      inputMapping?: InputMapping;
      saveAs?: string;
      onError?: { policy: 'fail' | 'continue' };
      idempotencyKey?: Expr;
    };
    try {
      const raw = (step as { config?: unknown }).config ?? {};
      config = actionCallDef ? actionCallDef.configSchema.parse(raw) : (raw as typeof config);
    } catch (error) {
      throw stepError(
        step.id,
        path,
        'ValidationError',
        `Invalid action.call config: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!config.actionId || !config.version) {
      throw stepError(step.id, path, 'ValidationError', 'action.call requires actionId and version');
    }

    const onErrorPolicy = resolveOnErrorPolicy(step, config);

    try {
      let resolvedInput: Record<string, unknown>;
      try {
        resolvedInput =
          (await resolveInputMapping(config.inputMapping ?? {}, {
            expressionContext: buildExpressionContext(),
            secretResolver,
            workflowRunId: scopes.system.runId,
          })) ?? {};
      } catch (error) {
        const message = isRecord(error) && typeof error.message === 'string' ? error.message : String(error);
        throw stepError(step.id, path, 'ExpressionError', message);
      }

      const output = stubActionOutput({
        stepId: step.id,
        path,
        actionId: config.actionId,
        version: config.version,
        input: resolvedInput,
      });

      if (config.saveAs) {
        assignToScopePath(config.saveAs, output);
      }
      trace.push({
        stepId: step.id,
        path,
        type: 'action.call',
        outcome: 'stubbed',
        evaluatedInput: resolvedInput,
        output,
        ...(config.saveAs ? { savedAs: config.saveAs } : {}),
      });
    } catch (error) {
      if (error instanceof SimulationStepError && onErrorPolicy === 'continue') {
        scopes.error = error.runtimeError;
        trace.push({
          stepId: step.id,
          path,
          type: 'action.call',
          outcome: 'error',
          handledBy: 'onError-continue',
          message: error.message,
        });
        return;
      }
      throw error;
    }
  };

  // Every step that starts gets exactly one trace entry — mirroring the
  // interpreter's step-start projection — so a failing step's entry carries
  // outcome 'error' instead of the step silently missing from the trace.
  // `sinceIndex` scopes the dedupe to this execution: loop iterations revisit
  // the same path and must trace again.
  const traceStepFailure = (step: Step, path: string, error: unknown, sinceIndex: number): void => {
    if (!(error instanceof SimulationStepError)) return;
    const alreadyTraced = trace
      .slice(sinceIndex)
      .some((entry) => entry.stepId === step.id && entry.path === path);
    if (!alreadyTraced) {
      trace.push({ stepId: step.id, path, type: step.type, outcome: 'error', message: error.message });
    }
  };

  const annotateHandledFailure = (stepId: string, handledBy: 'tryCatch' | 'forEach-continue'): void => {
    for (let index = trace.length - 1; index >= 0; index -= 1) {
      if (trace[index].stepId === stepId && trace[index].outcome === 'error') {
        trace[index].handledBy = handledBy;
        return;
      }
    }
  };

  const runSequence = async (steps: Step[], sequencePath: string, ctx: SequenceContext): Promise<void> => {
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const path = `${sequencePath}[${index}]`;
      checkBudgets(step.id, path);
      const traceMark = trace.length;

      try {
      switch (step.type) {
        case 'control.return': {
          trace.push({ stepId: step.id, path, type: step.type, outcome: 'executed' });
          throw new SimulationHalt('completed');
        }

        case 'control.if': {
          const ifStep = step as IfBlock;
          const value = await evaluateExpr(ifStep.condition, step.id, path);
          if (typeof value !== 'boolean') {
            throw stepError(step.id, path, 'ExpressionError', 'control.if condition must evaluate to a boolean');
          }
          const branch = value ? 'then' : 'else';
          trace.push({ stepId: step.id, path, type: step.type, outcome: 'executed', branchTaken: branch });
          const branchSteps = value ? ifStep.then : ifStep.else ?? [];
          await runSequence(branchSteps, `${path}.${branch}.steps`, ctx);
          break;
        }

        case 'control.forEach': {
          const forEachStep = step as ForEachBlock;
          const items = await evaluateExpr(forEachStep.items, step.id, path);
          if (!Array.isArray(items)) {
            throw stepError(step.id, path, 'ExpressionError', 'control.forEach items did not evaluate to an array');
          }
          if (items.length > maxForEachIterations) {
            throw stepError(
              step.id,
              path,
              'QuotaExceeded',
              `control.forEach would iterate ${items.length} times, exceeding the ${maxForEachIterations}-iteration budget`
            );
          }
          trace.push({ stepId: step.id, path, type: step.type, outcome: 'executed' });

          const itemVar = forEachStep.itemVar;
          const hadPrevious = Object.prototype.hasOwnProperty.call(scopes.vars, itemVar);
          const previous = scopes.vars[itemVar];
          // Node handlers clone vars, so loop bookkeeping must always be
          // re-read from the live scopes rather than captured once.
          const currentLoops = (): Record<string, unknown> => {
            if (!isRecord(scopes.vars.__forEach)) {
              scopes.vars.__forEach = {};
            }
            return scopes.vars.__forEach as Record<string, unknown>;
          };

          for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
            currentLoops()[forEachStep.id] = {
              items,
              index: itemIndex,
              itemVar,
              previous,
              hadPrevious,
            };
            scopes.vars[itemVar] = items[itemIndex];
            scopes.lexical.push({
              __loopId: forEachStep.id,
              [itemVar]: items[itemIndex],
              item: items[itemIndex],
              index: itemIndex,
              length: items.length,
              isFirst: itemIndex === 0,
              isLast: itemIndex === items.length - 1,
            });
            try {
              await runSequence(forEachStep.body, `${path}.body.steps`, {
                tryDepth: ctx.tryDepth,
                loopContinue: (forEachStep.onItemError ?? 'fail') === 'continue',
              });
            } catch (error) {
              scopes.lexical.pop();
              throw error;
            }
            scopes.lexical.pop();
          }

          delete currentLoops()[forEachStep.id];
          if (hadPrevious) {
            scopes.vars[itemVar] = previous;
          } else {
            delete scopes.vars[itemVar];
          }
          break;
        }

        case 'control.tryCatch': {
          const tryCatchStep = step as TryCatchBlock;
          trace.push({ stepId: step.id, path, type: step.type, outcome: 'executed' });
          try {
            await runSequence(tryCatchStep.try, `${path}.try.steps`, {
              tryDepth: ctx.tryDepth + 1,
              loopContinue: ctx.loopContinue,
            });
          } catch (error) {
            if (!(error instanceof SimulationStepError) || error.fatal) throw error;
            scopes.error = error.runtimeError;
            if (tryCatchStep.captureErrorAs) {
              assignToScopePath(`vars.${tryCatchStep.captureErrorAs}`, error.runtimeError);
            }
            annotateHandledFailure(error.stepId, 'tryCatch');
            await runSequence(tryCatchStep.catch, `${path}.catch.steps`, ctx);
          }
          break;
        }

        case 'control.callWorkflow': {
          const callStep = step as Step & {
            workflowId: string;
            workflowVersion: number;
            inputMapping?: Record<string, Expr>;
            outputMapping?: Record<string, Expr>;
          };
          const childPayload: Record<string, unknown> = {};
          for (const [key, expr] of Object.entries(callStep.inputMapping ?? {})) {
            childPayload[key] = await evaluateExpr(expr, step.id, path);
          }

          const fixture = fixtureFor(step.id, `workflow:${callStep.workflowId}`);
          if (fixture === undefined) {
            trace.push({
              stepId: step.id,
              path,
              type: step.type,
              outcome: 'would-wait',
              evaluatedInput: childPayload,
              message: `Would call workflow ${callStep.workflowId}@${callStep.workflowVersion}`,
            });
            warnings.push({
              stepId: step.id,
              path,
              message: `Simulation paused: control.callWorkflow has no fixture for ${callStep.workflowId}@${callStep.workflowVersion}`,
            });
            throw new SimulationHalt('paused-at-wait');
          }

          const childResult = isRecord(fixture) ? fixture : {};
          if (callStep.outputMapping) {
            const childScopesFixture = {
              payload: isRecord(childResult.payload) ? childResult.payload : {},
              vars: isRecord(childResult.vars) ? childResult.vars : {},
            };
            const childContext = {
              ...buildExpressionContext(),
              childRun: {
                payload: childScopesFixture.payload,
                vars: childScopesFixture.vars,
                local: {},
                system: { ...scopes.system, runId: 'simulated-child-run' },
                meta: {},
              },
            };
            for (const [target, expr] of Object.entries(callStep.outputMapping)) {
              try {
                assignToScopePath(target, await compileExpression(expr).evaluate(childContext));
              } catch (error) {
                throw stepError(step.id, path, 'ExpressionError', error instanceof Error ? error.message : String(error));
              }
            }
          }
          trace.push({
            stepId: step.id,
            path,
            type: step.type,
            outcome: 'stubbed',
            evaluatedInput: childPayload,
            message: `Stubbed child workflow ${callStep.workflowId}@${callStep.workflowVersion} from fixture`,
          });
          break;
        }

        case 'event.wait': {
          const config = isRecord((step as { config?: unknown }).config)
            ? ((step as { config?: unknown }).config as Record<string, unknown>)
            : {};
          const eventName = typeof config.eventName === 'string' ? config.eventName : 'UNKNOWN_EVENT';
          const fixture = fixtureFor(step.id, eventName);
          if (fixture === undefined) {
            trace.push({ stepId: step.id, path, type: step.type, outcome: 'would-wait', message: `Would wait for event ${eventName}` });
            warnings.push({ stepId: step.id, path, message: `Simulation paused: event.wait has no fixture for ${eventName}` });
            throw new SimulationHalt('paused-at-wait');
          }
          scopes.vars.event = isRecord(fixture) ? fixture : { value: fixture };
          scopes.vars.eventName = eventName;
          if (isExprRecord(config.assign)) {
            await applyAssignExpressions(config.assign, step.id, path);
          }
          trace.push({ stepId: step.id, path, type: step.type, outcome: 'executed', message: 'Resumed from fixture' });
          break;
        }

        case 'time.wait': {
          const config = isRecord((step as { config?: unknown }).config)
            ? ((step as { config?: unknown }).config as Record<string, unknown>)
            : {};
          const fixture = fixtureFor(step.id);
          if (fixture === undefined) {
            trace.push({ stepId: step.id, path, type: step.type, outcome: 'would-wait', message: 'Would wait for time' });
            warnings.push({ stepId: step.id, path, message: 'Simulation paused: time.wait has no fixture' });
            throw new SimulationHalt('paused-at-wait');
          }
          scopes.vars.timeWait = {
            mode: typeof config.mode === 'string' ? config.mode : 'duration',
            dueAt: null,
            resumedAt: new Date().toISOString(),
          };
          if (isExprRecord(config.assign)) {
            await applyAssignExpressions(config.assign, step.id, path);
          }
          trace.push({ stepId: step.id, path, type: step.type, outcome: 'executed', message: 'Resumed from fixture' });
          break;
        }

        case 'human.task': {
          const config = isRecord((step as { config?: unknown }).config)
            ? ((step as { config?: unknown }).config as Record<string, unknown>)
            : {};
          const taskType = typeof config.taskType === 'string' ? config.taskType : 'unknown';
          const fixture = fixtureFor(step.id, taskType);
          if (fixture === undefined) {
            trace.push({ stepId: step.id, path, type: step.type, outcome: 'would-wait', message: `Would create human task ${taskType}` });
            warnings.push({ stepId: step.id, path, message: `Simulation paused: human.task has no fixture for ${taskType}` });
            throw new SimulationHalt('paused-at-wait');
          }
          scopes.vars.event = isRecord(fixture) ? fixture : { value: fixture };
          scopes.vars.eventName = 'HUMAN_TASK_COMPLETED';
          if (isExprRecord(config.assign)) {
            await applyAssignExpressions(config.assign, step.id, path);
          }
          trace.push({ stepId: step.id, path, type: step.type, outcome: 'executed', message: 'Resumed from fixture' });
          break;
        }

        case 'action.call': {
          await runActionCall(step, path);
          break;
        }

        default: {
          await runNodeHandler(step, path);
          break;
        }
      }
      } catch (error) {
        traceStepFailure(step, path, error, traceMark);
        // onItemError: 'continue' matches the interpreter: when no tryCatch
        // encloses the failed step and the nearest loop allows it, record the
        // error and continue with the NEXT STEP of the same item. Only
        // failures originating at this step qualify — bubbled failures were
        // already adjudicated at their own level.
        if (
          error instanceof SimulationStepError &&
          !error.fatal &&
          error.stepId === step.id &&
          ctx.tryDepth === 0 &&
          ctx.loopContinue
        ) {
          scopes.error = error.runtimeError;
          annotateHandledFailure(error.stepId, 'forEach-continue');
          continue;
        }
        throw error;
      }
    }
  };

  let status: WorkflowSimulationResult['status'] = 'completed';
  try {
    await runSequence(definition.steps, 'root.steps', { tryDepth: 0, loopContinue: false });
  } catch (error) {
    if (error instanceof SimulationHalt) {
      status = error.status;
    } else if (error instanceof SimulationStepError) {
      status = 'failed';
      errors.push({ stepId: error.stepId, path: error.path, message: error.message });
    } else {
      status = 'failed';
      errors.push({ message: error instanceof Error ? error.message : String(error) });
    }
  }

  // Loop bookkeeping mirrors the interpreter's vars.__forEach; drop it from the
  // API-facing result once every loop has unwound.
  if (isRecord(scopes.vars.__forEach) && Object.keys(scopes.vars.__forEach as Record<string, unknown>).length === 0) {
    delete scopes.vars.__forEach;
  }

  return {
    status,
    trace,
    finalVars: scopes.vars,
    finalPayload: scopes.payload,
    invocations,
    errors,
    warnings,
  };
}

/**
 * Apply an event trigger's payloadMapping the same way run-start does:
 * expressions evaluate against `{ event: { name, correlationKey, payload,
 * payloadSchemaRef } }` and dotted result keys expand into nested objects.
 */
export async function applyTriggerPayloadMapping(params: {
  definition: WorkflowDefinition;
  eventName: string;
  eventPayload: Record<string, unknown>;
  correlationKey?: string | null;
  sourcePayloadSchemaRef?: string | null;
  secretResolver?: SecretResolver;
}): Promise<{ payload: Record<string, unknown>; mappingApplied: boolean }> {
  const trigger = params.definition.trigger;
  if (!trigger || trigger.type !== 'event') {
    return { payload: params.eventPayload, mappingApplied: false };
  }
  const mapping = trigger.payloadMapping;
  if (!mapping || Object.keys(mapping).length === 0) {
    return { payload: params.eventPayload, mappingApplied: false };
  }

  const resolved = await resolveInputMapping(mapping, {
    expressionContext: {
      event: {
        name: params.eventName,
        correlationKey: params.correlationKey ?? null,
        payload: params.eventPayload,
        payloadSchemaRef: params.sourcePayloadSchemaRef ?? trigger.sourcePayloadSchemaRef ?? null,
      },
    },
    secretResolver: params.secretResolver,
  });
  // LEVERAGE: pattern expand-dotted-keys — same expansion exists privately in workflow-runtime-v2-actions.ts
  return { payload: expandDottedKeys(resolved ?? {}), mappingApplied: true };
}

function expandDottedKeys(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key.includes('.')) {
      result[key] = value;
      continue;
    }
    const parts = key.split('.').filter(Boolean);
    if (parts.length === 0) continue;
    let cursor: Record<string, unknown> = result;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (i === parts.length - 1) {
        cursor[part] = value;
        continue;
      }
      const existing = cursor[part];
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        cursor = existing as Record<string, unknown>;
        continue;
      }
      const next: Record<string, unknown> = {};
      cursor[part] = next;
      cursor = next;
    }
  }
  return result;
}

function stepError(stepId: string, path: string, category: string, message: string, fatal = false): SimulationStepError {
  return new SimulationStepError(
    message,
    stepId,
    path,
    {
      category,
      message,
      nodePath: path,
      at: new Date().toISOString(),
    },
    fatal
  );
}

function resolveOnErrorPolicy(
  step: Step,
  config: { onError?: { policy: 'fail' | 'continue' } }
): 'fail' | 'continue' {
  const stepOnError = (step as { onError?: { policy?: string } }).onError;
  if (stepOnError?.policy === 'continue' || stepOnError?.policy === 'fail') {
    return stepOnError.policy;
  }
  if (config.onError?.policy === 'continue' || config.onError?.policy === 'fail') {
    return config.onError.policy;
  }
  return 'fail';
}

function normalizeAssignmentPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return 'vars';

  const scoped =
    trimmed.startsWith('payload.') ||
    trimmed.startsWith('vars.') ||
    trimmed.startsWith('meta.') ||
    trimmed.startsWith('local.') ||
    trimmed.startsWith('/');
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
  if (parts.length === 0) return;
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

function isErrorFixture(value: unknown): value is { $error: Record<string, unknown> } {
  return isRecord(value) && isRecord(value.$error);
}

function isExprRecord(value: unknown): value is Record<string, Expr> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => isRecord(entry) && typeof entry.$expr === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function safeByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}
