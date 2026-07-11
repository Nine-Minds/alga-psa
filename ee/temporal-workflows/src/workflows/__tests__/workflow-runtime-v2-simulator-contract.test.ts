/**
 * Anti-drift contract tests: fixture workflows run through BOTH the real
 * Temporal interpreter loop (workflowRuntimeV2RunWorkflow with mocked
 * activities — node steps execute the real registered handlers, action.call
 * returns stubbed outputs) and the in-process simulator. Branch decisions,
 * step ordering, and final vars must match exactly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime';

type RuntimeV2Activities = {
  loadWorkflowRuntimeV2PinnedDefinition: ReturnType<typeof vi.fn>;
  executeWorkflowRuntimeV2NodeStep: ReturnType<typeof vi.fn>;
  projectWorkflowRuntimeV2StepStart: ReturnType<typeof vi.fn>;
  projectWorkflowRuntimeV2StepCompletion: ReturnType<typeof vi.fn>;
  executeWorkflowRuntimeV2ActionStep: ReturnType<typeof vi.fn>;
  startWorkflowRuntimeV2ChildRun: ReturnType<typeof vi.fn>;
  projectWorkflowRuntimeV2TimeWaitStart: ReturnType<typeof vi.fn>;
  projectWorkflowRuntimeV2TimeWaitResolved: ReturnType<typeof vi.fn>;
  projectWorkflowRuntimeV2EventWaitStart: ReturnType<typeof vi.fn>;
  projectWorkflowRuntimeV2EventWaitResolved: ReturnType<typeof vi.fn>;
  startWorkflowRuntimeV2HumanTaskWait: ReturnType<typeof vi.fn>;
  resolveWorkflowRuntimeV2HumanTaskWait: ReturnType<typeof vi.fn>;
  validateWorkflowRuntimeV2HumanTaskResponse: ReturnType<typeof vi.fn>;
  completeWorkflowRuntimeV2Run: ReturnType<typeof vi.fn>;
};

let mockActivities: RuntimeV2Activities;

vi.mock('@temporalio/workflow', () => {
  class ApplicationFailure extends Error {
    type?: string | null;
    nonRetryable?: boolean;
    details?: unknown[];

    static nonRetryable(message?: string | null, type?: string | null, ...details: unknown[]) {
      const failure = new ApplicationFailure(message ?? '');
      failure.type = type;
      failure.nonRetryable = true;
      failure.details = details;
      return failure;
    }
  }

  return {
    ApplicationFailure,
    continueAsNew: vi.fn(async () => undefined),
    condition: vi.fn(async (predicate: () => boolean) => predicate()),
    defineQuery: vi.fn((name: string) => name),
    defineSignal: vi.fn((name: string) => name),
    executeChild: vi.fn(async () => undefined),
    proxyActivities: vi.fn(() => mockActivities),
    setHandler: vi.fn(),
    sleep: vi.fn(async () => undefined),
  };
});

import { registerDefaultNodes } from '@shared/workflow/runtime/nodes/registerDefaultNodes';
import { getNodeTypeRegistry } from '@shared/workflow/runtime/registries/nodeTypeRegistry';
import { simulateWorkflowDefinition } from '@shared/workflow/runtime/simulation/simulator';
import { buildWorkflowRuntimeV2ExpressionContext, type WorkflowRuntimeV2ScopeState } from '../workflow-runtime-v2-interpreter.js';
import type { Envelope } from '@shared/workflow/runtime/types';

const loadWorkflow = async () => {
  vi.resetModules();
  return import('../workflow-runtime-v2-run-workflow.js');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Interpreter-side node execution: the same envelope conversion the real
 * executeWorkflowRuntimeV2NodeStep activity performs, driving the REAL
 * registered node handlers (transform.assign, state.set, …).
 */
const executeNodeStepLikeActivity = async (input: {
  runId: string;
  stepPath: string;
  step: { type: string; config?: unknown };
  scopes: WorkflowRuntimeV2ScopeState;
}): Promise<{ scopes: WorkflowRuntimeV2ScopeState }> => {
  const registry = getNodeTypeRegistry();
  const nodeType = registry.get(input.step.type);
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
    error: input.scopes.error
      ? {
          message: String(input.scopes.error.message ?? ''),
          at: typeof input.scopes.error.at === 'string' ? input.scopes.error.at : new Date().toISOString(),
        }
      : undefined,
  };

  const result = await nodeType.handler(env, parsedConfig, {
    runId: input.runId,
    stepPath: input.stepPath,
    tenantId: input.scopes.system.tenantId,
    nowIso: () => new Date().toISOString(),
    actions: {
      call: async () => {
        throw new Error('contract fixtures must not call actions from node handlers');
      },
    },
    publishWait: async () => {
      throw new Error('contract fixtures must not wait');
    },
    resumeEvent: null,
    resumeError: null,
  });

  if ('type' in result) {
    throw new Error(`Node step ${input.step.type} returned control result ${result.type}`);
  }

  return {
    scopes: {
      ...input.scopes,
      payload: isRecord(result.payload) ? result.payload : input.scopes.payload,
      workflow: isRecord(result.vars) ? result.vars : input.scopes.workflow,
      meta: isRecord(result.meta) ? result.meta : (isRecord(input.scopes.meta) ? input.scopes.meta : {}),
      error: result.error && typeof result.error === 'object' ? (result.error as Record<string, unknown>) : null,
    },
  };
};

type ActionFixture = unknown | { $error: { message: string; category?: string } };

const isErrorFixture = (value: unknown): value is { $error: { message: string; category?: string } } =>
  isRecord(value) && isRecord(value.$error);

type InterpreterOutcome = {
  startedStepIds: string[];
  startedStepPaths: string[];
  finalVars: Record<string, unknown>;
  status: 'SUCCEEDED' | 'FAILED';
};

/** Run the real interpreter loop over a definition with stubbed actions. */
const runInterpreter = async (params: {
  definition: WorkflowDefinition;
  payload: Record<string, unknown>;
  fixtures: Record<string, ActionFixture>;
}): Promise<InterpreterOutcome> => {
  const startedStepIds: string[] = [];
  const startedStepPaths: string[] = [];
  let stepCounter = 0;

  mockActivities = {
    loadWorkflowRuntimeV2PinnedDefinition: vi.fn(async () => ({
      definition: params.definition,
      initialScopes: {
        payload: JSON.parse(JSON.stringify(params.payload)),
        workflow: {},
        lexical: [],
        meta: {},
        error: null,
        system: {
          runId: 'run_contract',
          workflowId: params.definition.id,
          workflowVersion: params.definition.version,
          tenantId: 'tenant_contract',
          definitionHash: null,
          runtimeSemanticsVersion: null,
        },
      },
    })),
    executeWorkflowRuntimeV2NodeStep: vi.fn(async (input: Parameters<typeof executeNodeStepLikeActivity>[0]) =>
      executeNodeStepLikeActivity(input)
    ),
    projectWorkflowRuntimeV2StepStart: vi.fn(async (input: { definitionStepId: string; stepPath: string }) => {
      stepCounter += 1;
      startedStepIds.push(input.definitionStepId);
      startedStepPaths.push(input.stepPath);
      return { stepId: `step-${stepCounter}` };
    }),
    projectWorkflowRuntimeV2StepCompletion: vi.fn(async () => undefined),
    executeWorkflowRuntimeV2ActionStep: vi.fn(
      async (input: { stepPath: string; step: { config?: unknown }; scopes: WorkflowRuntimeV2ScopeState }) => {
        const config = (input.step.config ?? {}) as { actionId?: string; saveAs?: string };
        const stepId = input.stepPath.split('[').pop() ?? '';
        void stepId;
        // Fixtures are keyed by definition step id; recover it from the path
        // via the definition itself (paths are deterministic, but the step id
        // is simpler to resolve from the started list).
        const definitionStepId = startedStepIds[startedStepIds.length - 1];
        const fixture =
          params.fixtures[definitionStepId] !== undefined
            ? params.fixtures[definitionStepId]
            : config.actionId
              ? params.fixtures[config.actionId]
              : undefined;
        if (isErrorFixture(fixture)) {
          throw {
            category: fixture.$error.category ?? 'ActionError',
            message: fixture.$error.message,
            nodePath: input.stepPath,
            at: new Date().toISOString(),
          };
        }
        return {
          output: fixture !== undefined ? fixture : {},
          saveAsPath: typeof config.saveAs === 'string' ? config.saveAs : null,
        };
      }
    ),
    startWorkflowRuntimeV2ChildRun: vi.fn(),
    projectWorkflowRuntimeV2TimeWaitStart: vi.fn(),
    projectWorkflowRuntimeV2TimeWaitResolved: vi.fn(),
    projectWorkflowRuntimeV2EventWaitStart: vi.fn(),
    projectWorkflowRuntimeV2EventWaitResolved: vi.fn(),
    startWorkflowRuntimeV2HumanTaskWait: vi.fn(),
    resolveWorkflowRuntimeV2HumanTaskWait: vi.fn(),
    validateWorkflowRuntimeV2HumanTaskResponse: vi.fn(),
    completeWorkflowRuntimeV2Run: vi.fn(async () => undefined),
  };

  const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

  let status: InterpreterOutcome['status'] = 'SUCCEEDED';
  let finalVars: Record<string, unknown> = {};
  try {
    const result = await workflowRuntimeV2RunWorkflow({
      runId: 'run_contract',
      tenantId: 'tenant_contract',
      workflowId: params.definition.id,
      workflowVersion: params.definition.version,
      triggerType: null,
      executionKey: 'exec_contract',
    });
    finalVars = result.scopes.workflow;
  } catch {
    status = 'FAILED';
    const completeCalls = mockActivities.completeWorkflowRuntimeV2Run.mock.calls;
    void completeCalls;
  }

  return { startedStepIds, startedStepPaths, finalVars, status };
};

const stripLoopBookkeeping = (vars: Record<string, unknown>): Record<string, unknown> => {
  const clone = JSON.parse(JSON.stringify(vars)) as Record<string, unknown>;
  if (isRecord(clone.__forEach) && Object.keys(clone.__forEach).length === 0) {
    delete clone.__forEach;
  }
  return clone;
};

const runBoth = async (params: {
  definition: WorkflowDefinition;
  payload: Record<string, unknown>;
  fixtures?: Record<string, ActionFixture>;
}) => {
  const fixtures = params.fixtures ?? {};
  const interpreter = await runInterpreter({ definition: params.definition, payload: params.payload, fixtures });
  const simulation = await simulateWorkflowDefinition({
    definition: params.definition,
    payload: params.payload,
    fixtures,
  });
  return { interpreter, simulation };
};

const expectContractParity = (outcome: Awaited<ReturnType<typeof runBoth>>) => {
  // The simulator traces exactly one entry per started step, mirroring the
  // interpreter's step-start projection — so the sequences compare directly.
  const simulatedStepIds = outcome.simulation.trace.map((entry) => entry.stepId);
  expect(simulatedStepIds).toEqual(outcome.interpreter.startedStepIds);
  expect(stripLoopBookkeeping(outcome.simulation.finalVars)).toEqual(
    stripLoopBookkeeping(outcome.interpreter.finalVars)
  );
};

const NODES_READY = (() => {
  if (!getNodeTypeRegistry().get('action.call')) {
    registerDefaultNodes();
  }
  return true;
})();

describe('simulator ↔ interpreter contract', () => {
  beforeEach(() => {
    expect(NODES_READY).toBe(true);
  });

  it('matches on control.if branches and transform.assign effects (then arm)', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_contract_if',
      name: 'If contract',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'branch',
          type: 'control.if',
          condition: { $expr: 'payload.amount > 10' },
          then: [
            { id: 'assign_then', type: 'transform.assign', config: { assign: { 'vars.tier': { $expr: '"vip"' }, 'vars.double': { $expr: 'payload.amount * 2' } } } },
          ],
          else: [
            { id: 'assign_else', type: 'transform.assign', config: { assign: { 'vars.tier': { $expr: '"standard"' } } } },
          ],
        },
        { id: 'tail', type: 'transform.assign', config: { assign: { 'vars.done': { $expr: 'true' } } } },
      ],
    };

    const outcome = await runBoth({ definition, payload: { amount: 25 } });
    expect(outcome.interpreter.status).toBe('SUCCEEDED');
    expect(outcome.simulation.status).toBe('completed');
    expectContractParity(outcome);
    expect(outcome.simulation.finalVars.tier).toBe('vip');
  });

  it('matches on the else arm', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_contract_else',
      name: 'Else contract',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'branch',
          type: 'control.if',
          condition: { $expr: 'payload.amount > 10' },
          then: [{ id: 'assign_then', type: 'transform.assign', config: { assign: { 'vars.tier': { $expr: '"vip"' } } } }],
          else: [{ id: 'assign_else', type: 'transform.assign', config: { assign: { 'vars.tier': { $expr: '"standard"' } } } }],
        },
      ],
    };

    const outcome = await runBoth({ definition, payload: { amount: 3 } });
    expectContractParity(outcome);
    expect(outcome.simulation.finalVars.tier).toBe('standard');
  });

  it('matches forEach iteration order, loop vars, and itemVar restore', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_contract_foreach',
      name: 'ForEach contract',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        { id: 'seed', type: 'transform.assign', config: { assign: { 'vars.collected': { $expr: '[]' }, 'vars.entry': { $expr: '"before"' } } } },
        {
          id: 'loop',
          type: 'control.forEach',
          items: { $expr: 'payload.items' },
          itemVar: 'entry',
          body: [
            {
              id: 'branch',
              type: 'control.if',
              condition: { $expr: 'entry != "skip"' },
              then: [
                { id: 'collect', type: 'transform.assign', config: { assign: { 'vars.collected': { $expr: 'append(vars.collected, vars.entry)' } } } },
              ],
            },
          ],
        },
        { id: 'after', type: 'transform.assign', config: { assign: { 'vars.final': { $expr: 'vars.entry' } } } },
      ],
    };

    const outcome = await runBoth({ definition, payload: { items: ['a', 'skip', 'b'] } });
    expectContractParity(outcome);
    expect(outcome.simulation.finalVars.collected).toEqual(['a', 'b']);
    expect(outcome.simulation.finalVars.final).toBe('before');
  });

  it('matches action.call stubbing with saveAs and downstream branching on the output', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_contract_action',
      name: 'Action contract',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'lookup',
          type: 'action.call',
          config: {
            actionId: 'test.lookup',
            version: 1,
            inputMapping: { key: { $expr: 'payload.key' } },
            saveAs: 'vars.lookup',
          },
        },
        {
          id: 'branch',
          type: 'control.if',
          condition: { $expr: 'vars.lookup.score > 5' },
          then: [{ id: 'high', type: 'transform.assign', config: { assign: { 'vars.result': { $expr: '"high"' } } } }],
          else: [{ id: 'low', type: 'transform.assign', config: { assign: { 'vars.result': { $expr: '"low"' } } } }],
        },
      ],
    };

    const outcome = await runBoth({
      definition,
      payload: { key: 'k1' },
      fixtures: { lookup: { score: 9 } },
    });
    expectContractParity(outcome);
    expect(outcome.simulation.finalVars.result).toBe('high');
  });

  it('matches tryCatch routing and captureErrorAs on action failure', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_contract_trycatch',
      name: 'TryCatch contract',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'guard',
          type: 'control.tryCatch',
          captureErrorAs: 'caught',
          try: [
            { id: 'boom', type: 'action.call', config: { actionId: 'test.boom', version: 1 } },
            { id: 'unreached', type: 'transform.assign', config: { assign: { 'vars.unreached': { $expr: 'true' } } } },
          ],
          catch: [
            { id: 'recover', type: 'transform.assign', config: { assign: { 'vars.recovered': { $expr: 'true' } } } },
          ],
        },
      ],
    };

    const outcome = await runBoth({
      definition,
      payload: {},
      fixtures: { boom: { $error: { message: 'synthetic failure' } } },
    });
    expect(outcome.interpreter.status).toBe('SUCCEEDED');
    expect(outcome.simulation.status).toBe('completed');

    // Step ordering: the interpreter records the failed step as started too.
    expect(outcome.interpreter.startedStepIds).toEqual(['guard', 'boom', 'recover']);
    expect(outcome.simulation.trace.map((entry) => entry.stepId)).toEqual(['guard', 'boom', 'recover']);
    expect(outcome.simulation.trace[1]?.handledBy).toBe('tryCatch');

    const interpreterVars = stripLoopBookkeeping(outcome.interpreter.finalVars);
    const simulatorVars = stripLoopBookkeeping(outcome.simulation.finalVars);
    expect(simulatorVars.recovered).toBe(true);
    expect(interpreterVars.recovered).toBe(true);
    expect(simulatorVars.unreached).toBeUndefined();
    expect(interpreterVars.unreached).toBeUndefined();
    expect((simulatorVars.caught as Record<string, unknown>).message).toBe('synthetic failure');
    expect((interpreterVars.caught as Record<string, unknown>).message).toBe('synthetic failure');
  });

  it('matches control.return early exit', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_contract_return',
      name: 'Return contract',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        { id: 'first', type: 'transform.assign', config: { assign: { 'vars.first': { $expr: 'true' } } } },
        { id: 'stop', type: 'control.return' },
        { id: 'after', type: 'transform.assign', config: { assign: { 'vars.after': { $expr: 'true' } } } },
      ],
    };

    const outcome = await runBoth({ definition, payload: {} });
    expectContractParity(outcome);
    expect(outcome.simulation.finalVars.after).toBeUndefined();
  });

  it('matches multi-step nested branches inside a forEach body', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_contract_nested_branch',
      name: 'Nested branch contract',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        { id: 'seed', type: 'transform.assign', config: { assign: { 'vars.log': { $expr: '[]' } } } },
        {
          id: 'loop',
          type: 'control.forEach',
          items: { $expr: 'payload.items' },
          itemVar: 'entry',
          body: [
            {
              id: 'branch',
              type: 'control.if',
              condition: { $expr: 'true' },
              then: [
                { id: 'first', type: 'transform.assign', config: { assign: { 'vars.log': { $expr: 'append(vars.log, vars.entry & ":first")' } } } },
                { id: 'second', type: 'transform.assign', config: { assign: { 'vars.log': { $expr: 'append(vars.log, vars.entry & ":second")' } } } },
              ],
            },
          ],
        },
        { id: 'after', type: 'transform.assign', config: { assign: { 'vars.done': { $expr: 'true' } } } },
      ],
    };

    const outcome = await runBoth({ definition, payload: { items: ['x', 'y'] } });
    expect(outcome.interpreter.status).toBe('SUCCEEDED');
    expectContractParity(outcome);
    expect(outcome.simulation.finalVars.log).toEqual(['x:first', 'x:second', 'y:first', 'y:second']);
  });

  it('matches onItemError continue semantics: the item continues past the failed step', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_contract_onitemerror',
      name: 'onItemError contract',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        { id: 'seed', type: 'transform.assign', config: { assign: { 'vars.log': { $expr: '[]' } } } },
        {
          id: 'loop',
          type: 'control.forEach',
          items: { $expr: 'payload.items' },
          itemVar: 'entry',
          onItemError: 'continue',
          body: [
            { id: 'boom', type: 'action.call', config: { actionId: 'test.boom', version: 1 } },
            { id: 'record', type: 'transform.assign', config: { assign: { 'vars.log': { $expr: 'append(vars.log, vars.entry)' } } } },
          ],
        },
      ],
    };

    const outcome = await runBoth({
      definition,
      payload: { items: ['x', 'y'] },
      fixtures: { boom: { $error: { message: 'per-item failure' } } },
    });
    expect(outcome.interpreter.status).toBe('SUCCEEDED');
    expect(outcome.simulation.status).toBe('completed');
    expectContractParity(outcome);
    // Pinned semantics: the failed step is skipped, the rest of the item runs.
    expect(outcome.simulation.finalVars.log).toEqual(['x', 'y']);
  });

  it('matches state.set through the real node handler', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_contract_state',
      name: 'State contract',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        { id: 'set_state', type: 'state.set', config: { state: 'processing' } },
        { id: 'tail', type: 'transform.assign', config: { assign: { 'vars.done': { $expr: 'true' } } } },
      ],
    };

    const outcome = await runBoth({ definition, payload: {} });
    expectContractParity(outcome);
  });
});
