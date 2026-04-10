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
const workflowSignalHandlers = new Map<string, (payload: unknown) => void>();

vi.mock('@temporalio/workflow', () => ({
  continueAsNew: vi.fn(async () => undefined),
  condition: vi.fn(async (predicate: () => boolean, timeoutMs?: number) => {
    if (predicate()) {
      return true;
    }
    if (timeoutMs === undefined) {
      return false;
    }
    return false;
  }),
  defineQuery: vi.fn((name: string) => name),
  defineSignal: vi.fn((name: string) => name),
  executeChild: vi.fn(async () => undefined),
  proxyActivities: vi.fn(() => mockActivities),
  setHandler: vi.fn((signalName: string, handler: (payload: unknown) => void) => {
    workflowSignalHandlers.set(signalName, handler);
  }),
  sleep: vi.fn(async () => undefined),
}));

const loadWorkflow = async () => {
  vi.resetModules();
  return import('../workflow-runtime-v2-run-workflow.js');
};

describe('workflowRuntimeV2RunWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflowSignalHandlers.clear();
    let stepCounter = 0;
    mockActivities = {
      loadWorkflowRuntimeV2PinnedDefinition: vi.fn(),
      executeWorkflowRuntimeV2NodeStep: vi.fn(),
      projectWorkflowRuntimeV2StepStart: vi.fn(),
      projectWorkflowRuntimeV2StepCompletion: vi.fn(),
      executeWorkflowRuntimeV2ActionStep: vi.fn(),
      startWorkflowRuntimeV2ChildRun: vi.fn(),
      projectWorkflowRuntimeV2TimeWaitStart: vi.fn(),
      projectWorkflowRuntimeV2TimeWaitResolved: vi.fn(),
      projectWorkflowRuntimeV2EventWaitStart: vi.fn(),
      projectWorkflowRuntimeV2EventWaitResolved: vi.fn(),
      startWorkflowRuntimeV2HumanTaskWait: vi.fn(),
      resolveWorkflowRuntimeV2HumanTaskWait: vi.fn(),
      validateWorkflowRuntimeV2HumanTaskResponse: vi.fn(),
      completeWorkflowRuntimeV2Run: vi.fn(),
    };

    mockActivities.projectWorkflowRuntimeV2StepStart.mockImplementation(async () => {
      stepCounter += 1;
      return { stepId: `step-${stepCounter}` };
    });
    mockActivities.completeWorkflowRuntimeV2Run.mockResolvedValue(undefined);
    mockActivities.projectWorkflowRuntimeV2StepCompletion.mockResolvedValue(undefined);
    mockActivities.executeWorkflowRuntimeV2NodeStep.mockImplementation(async ({ scopes }: { scopes: unknown }) => ({ scopes }));
    mockActivities.startWorkflowRuntimeV2ChildRun.mockResolvedValue({
      childRunId: 'child-run-default',
      rootRunId: 'root-run-default',
      temporalWorkflowId: 'workflow-runtime-v2:run:child-run-default',
    });
    mockActivities.projectWorkflowRuntimeV2TimeWaitStart.mockResolvedValue({
      waitId: 'wait-default',
    });
    mockActivities.projectWorkflowRuntimeV2TimeWaitResolved.mockResolvedValue(undefined);
    mockActivities.projectWorkflowRuntimeV2EventWaitStart.mockResolvedValue({
      waitId: 'wait-event-default',
    });
    mockActivities.projectWorkflowRuntimeV2EventWaitResolved.mockResolvedValue(undefined);
    mockActivities.startWorkflowRuntimeV2HumanTaskWait.mockResolvedValue({
      waitId: 'wait-human-default',
      taskId: 'task-default',
      eventName: 'HUMAN_TASK_COMPLETED',
    });
    mockActivities.resolveWorkflowRuntimeV2HumanTaskWait.mockResolvedValue(undefined);
    mockActivities.validateWorkflowRuntimeV2HumanTaskResponse.mockResolvedValue(undefined);
  });

  it('executes action.call through activity boundary then completes on control.return', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_1',
      name: 'Action + Return',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_action',
          type: 'action.call',
          config: {
            actionId: 'ticket.update',
            version: 1,
            saveAs: 'vars.lastAction',
          },
        },
        {
          id: 'step_return',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: { ticketId: 't_1' },
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_1',
          workflowId: 'wf_1',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_1',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    mockActivities.executeWorkflowRuntimeV2ActionStep.mockResolvedValue({
      output: { updated: true },
      saveAsPath: 'vars.lastAction',
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await workflowRuntimeV2RunWorkflow({
      runId: 'run_1',
      tenantId: 'tenant_1',
      workflowId: 'wf_1',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_1',
    });

    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenCalledTimes(1);
    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run_1',
        stepPath: 'root.steps[0]',
        step: expect.objectContaining({ type: 'action.call' }),
      })
    );
    expect(mockActivities.projectWorkflowRuntimeV2StepStart).toHaveBeenCalledTimes(2);
    expect(mockActivities.projectWorkflowRuntimeV2StepCompletion).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        runId: 'run_1',
        stepId: 'step-1',
        stepPath: 'root.steps[0]',
        status: 'SUCCEEDED',
      })
    );
    expect(mockActivities.projectWorkflowRuntimeV2StepCompletion).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        runId: 'run_1',
        stepId: 'step-2',
        stepPath: 'root.steps[1]',
        status: 'SUCCEEDED',
      })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_1',
      status: 'SUCCEEDED',
    });
  });

  it('evaluates control.if deterministically and executes the correct branch', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_2',
      name: 'If Branch',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_if',
          type: 'control.if',
          condition: { $expr: 'payload.shouldReturn = true' },
          then: [
            {
              id: 'step_then_return',
              type: 'control.return',
            },
          ],
          else: [
            {
              id: 'step_else_action',
              type: 'action.call',
              config: {
                actionId: 'ticket.update',
                version: 1,
              },
            },
          ],
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: { shouldReturn: true },
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_2',
          workflowId: 'wf_2',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_2',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await workflowRuntimeV2RunWorkflow({
      runId: 'run_2',
      tenantId: 'tenant_1',
      workflowId: 'wf_2',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_2',
    });

    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).not.toHaveBeenCalled();
    expect(mockActivities.projectWorkflowRuntimeV2StepStart).toHaveBeenCalledTimes(2);
    expect(mockActivities.projectWorkflowRuntimeV2StepStart).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stepPath: 'root.steps[0].then.steps[0]',
        definitionStepId: 'step_then_return',
      })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_2',
      status: 'SUCCEEDED',
    });
  });

  it('resolves nested control.if branches without losing interpreter position', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_2_nested_if',
      name: 'Nested If Branches',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_outer_if',
          type: 'control.if',
          condition: { $expr: 'payload.outer = true' },
          then: [
            {
              id: 'step_inner_if',
              type: 'control.if',
              condition: { $expr: 'payload.inner = true' },
              then: [
                {
                  id: 'step_nested_return',
                  type: 'control.return',
                },
              ],
            },
          ],
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: { outer: true, inner: true },
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_2_nested_if',
          workflowId: 'wf_2_nested_if',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_2_nested_if',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await workflowRuntimeV2RunWorkflow({
      runId: 'run_2_nested_if',
      tenantId: 'tenant_1',
      workflowId: 'wf_2_nested_if',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_2_nested_if',
    });

    expect(mockActivities.projectWorkflowRuntimeV2StepStart).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ stepPath: 'root.steps[0].then.steps[0]' })
    );
    expect(mockActivities.projectWorkflowRuntimeV2StepStart).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ stepPath: 'root.steps[0].then.steps[0].then.steps[0]' })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_2_nested_if',
      status: 'SUCCEEDED',
    });
  });

  it('keeps Temporal interpreter state synchronized for non-action node steps', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_2_node_sync',
      name: 'Node Step Sync',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_state_set',
          type: 'state.set',
          config: {
            state: 'ready',
          },
        },
        {
          id: 'step_action_after_node',
          type: 'action.call',
          config: {
            actionId: 'ticket.update',
            version: 1,
          },
        },
        {
          id: 'step_return_after_node',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        meta: {},
        error: null,
        system: {
          runId: 'run_2_node_sync',
          workflowId: 'wf_2_node_sync',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_2_node_sync',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.executeWorkflowRuntimeV2NodeStep.mockResolvedValue({
      scopes: {
        payload: {},
        workflow: { derivedFlag: true },
        lexical: [],
        meta: { state: 'ready' },
        error: null,
        system: {
          runId: 'run_2_node_sync',
          workflowId: 'wf_2_node_sync',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_2_node_sync',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.executeWorkflowRuntimeV2ActionStep.mockResolvedValue({
      output: { ok: true },
      saveAsPath: null,
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await workflowRuntimeV2RunWorkflow({
      runId: 'run_2_node_sync',
      tenantId: 'tenant_1',
      workflowId: 'wf_2_node_sync',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_2_node_sync',
    });

    expect(mockActivities.executeWorkflowRuntimeV2NodeStep).toHaveBeenCalledWith(
      expect.objectContaining({
        stepPath: 'root.steps[0]',
        step: expect.objectContaining({ type: 'state.set' }),
      })
    );
    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenCalledWith(
      expect.objectContaining({
        stepPath: 'root.steps[1]',
        scopes: expect.objectContaining({
          workflow: expect.objectContaining({ derivedFlag: true }),
          meta: expect.objectContaining({ state: 'ready' }),
        }),
      })
    );
  });

  it('accepts nowIso() in control.if via canonical expression engine semantics', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_3',
      name: 'nowIso parity',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_if',
          type: 'control.if',
          condition: { $expr: 'len(toString(nowIso())) > 0' },
          then: [{ id: 'step_return', type: 'control.return' }],
          else: [],
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_3',
          workflowId: 'wf_3',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_3',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_3',
      tenantId: 'tenant_1',
      workflowId: 'wf_3',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_3',
    })).resolves.toEqual({
      scopes: expect.objectContaining({
        system: expect.objectContaining({
          runId: 'run_3',
        }),
      }),
    });

    expect(mockActivities.projectWorkflowRuntimeV2StepCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run_3',
        status: 'SUCCEEDED',
      })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_3',
      status: 'SUCCEEDED',
    });
  });

  it('applies canonical expression source normalization (== to =) in Temporal execution', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_3_normalize',
      name: 'Normalization parity',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_if',
          type: 'control.if',
          condition: { $expr: '1 == 1' },
          then: [{ id: 'step_return', type: 'control.return' }],
          else: [],
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        meta: {},
        error: null,
        system: {
          runId: 'run_3_normalize',
          workflowId: 'wf_3_normalize',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_3_normalize',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_3_normalize',
      tenantId: 'tenant_1',
      workflowId: 'wf_3_normalize',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_3_normalize',
    })).resolves.toEqual({
      scopes: expect.objectContaining({
        system: expect.objectContaining({
          runId: 'run_3_normalize',
        }),
      }),
    });
  });

  it('rejects disallowed expression functions with canonical validation errors', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_3_disallowed',
      name: 'Disallowed function',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_if',
          type: 'control.if',
          condition: { $expr: 'sum([1, 2]) = 3' },
          then: [],
          else: [],
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        meta: {},
        error: null,
        system: {
          runId: 'run_3_disallowed',
          workflowId: 'wf_3_disallowed',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_3_disallowed',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_3_disallowed',
      tenantId: 'tenant_1',
      workflowId: 'wf_3_disallowed',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_3_disallowed',
    })).rejects.toThrow('disallowed function');
  });

  it('enforces canonical expression output-size guardrails', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_3_output_limit',
      name: 'Output guardrail',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_for_each',
          type: 'control.forEach',
          items: { $expr: 'payload.big' },
          itemVar: 'item',
          body: [],
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: { big: 'x'.repeat(256 * 1024 + 1) },
        workflow: {},
        lexical: [],
        meta: {},
        error: null,
        system: {
          runId: 'run_3_output_limit',
          workflowId: 'wf_3_output_limit',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_3_output_limit',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_3_output_limit',
      tenantId: 'tenant_1',
      workflowId: 'wf_3_output_limit',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_3_output_limit',
    })).rejects.toThrow('max output size');
  });

  it('retries action.call via interpreter policy and continues when onError=continue after retry exhaustion', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_4',
      name: 'Action retry',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_action',
          type: 'action.call',
          retry: {
            maxAttempts: 2,
            backoffMs: 1,
            backoffMultiplier: 1,
            jitter: false,
          },
          config: {
            actionId: 'ticket.update',
            version: 1,
            onError: {
              policy: 'continue',
            },
          },
        },
        {
          id: 'step_return',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_4',
          workflowId: 'wf_4',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_4',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    mockActivities.executeWorkflowRuntimeV2ActionStep.mockRejectedValue({
      category: 'ActionError',
      message: 'simulated action failure',
      nodePath: 'root.steps[0]',
      at: '2026-04-08T00:00:00.000Z',
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await workflowRuntimeV2RunWorkflow({
      runId: 'run_4',
      tenantId: 'tenant_1',
      workflowId: 'wf_4',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_4',
    });

    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenCalledTimes(2);
    expect(mockActivities.projectWorkflowRuntimeV2StepCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run_4',
        stepPath: 'root.steps[0]',
        status: 'SUCCEEDED',
        errorMessage: 'simulated action failure',
      })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_4',
      status: 'SUCCEEDED',
    });
  });

  it('routes try branch failures into control.tryCatch catch branch and binds captureErrorAs', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_5',
      name: 'TryCatch',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_try_catch',
          type: 'control.tryCatch',
          captureErrorAs: 'caughtError',
          try: [
            {
              id: 'step_try_action',
              type: 'action.call',
              config: {
                actionId: 'ticket.update',
                version: 1,
              },
            },
          ],
          catch: [
            {
              id: 'step_catch_action',
              type: 'action.call',
              config: {
                actionId: 'ticket.update',
                version: 1,
              },
            },
          ],
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_5',
          workflowId: 'wf_5',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_5',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    mockActivities.executeWorkflowRuntimeV2ActionStep
      .mockRejectedValueOnce({
        category: 'ActionError',
        message: 'try branch failed',
        nodePath: 'root.steps[0].try.steps[0]',
        at: '2026-04-08T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        output: { recovered: true },
        saveAsPath: null,
      });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await workflowRuntimeV2RunWorkflow({
      runId: 'run_5',
      tenantId: 'tenant_1',
      workflowId: 'wf_5',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_5',
    });

    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenCalledTimes(2);
    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stepPath: 'root.steps[0].catch.steps[0]',
        scopes: expect.objectContaining({
          workflow: expect.objectContaining({
            caughtError: expect.objectContaining({
              message: 'try branch failed',
              category: 'ActionError',
            }),
          }),
        }),
      })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_5',
      status: 'SUCCEEDED',
    });
  });

  it('does not swallow cancellation inside control.tryCatch and marks the run CANCELED', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_6',
      name: 'TryCatch cancellation',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_try_catch',
          type: 'control.tryCatch',
          captureErrorAs: 'caughtError',
          try: [
            {
              id: 'step_try_action',
              type: 'action.call',
              config: {
                actionId: 'ticket.update',
                version: 1,
              },
            },
          ],
          catch: [
            {
              id: 'step_catch_action',
              type: 'action.call',
              config: {
                actionId: 'ticket.update',
                version: 1,
              },
            },
          ],
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_6',
          workflowId: 'wf_6',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_6',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    mockActivities.executeWorkflowRuntimeV2ActionStep.mockRejectedValueOnce({
      name: 'CancelledFailure',
      message: 'workflow cancelled by operator',
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_6',
      tenantId: 'tenant_1',
      workflowId: 'wf_6',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_6',
    })).rejects.toMatchObject({
      name: 'CancelledFailure',
    });

    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenCalledTimes(1);
    expect(mockActivities.projectWorkflowRuntimeV2StepCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run_6',
        stepPath: 'root.steps[0].try.steps[0]',
        status: 'CANCELED',
      })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_6',
      status: 'CANCELED',
    });
  });

  it('fails fast when interpreter state is corrupted and no current step can be resolved', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_7',
      name: 'Corrupt interpreter state',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_7',
          workflowId: 'wf_7',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_7',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_7',
      tenantId: 'tenant_1',
      workflowId: 'wf_7',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_7',
      checkpoint: {
        stepCount: 42,
        state: {
          runId: 'run_7',
          currentStepPath: null,
          scopes: {
            payload: {},
            workflow: {},
            lexical: [],
            system: {
              runId: 'run_7',
              workflowId: 'wf_7',
              workflowVersion: 1,
              tenantId: 'tenant_1',
              definitionHash: 'hash_7',
              runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
            },
          },
          frames: [
            {
              kind: 'sequence',
              path: 'root.steps[99].try.steps',
              nextIndex: 0,
              totalSteps: 1,
            },
          ],
        },
      },
    })).rejects.toMatchObject({
      category: 'InterpreterCorruption',
    });

    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_7',
      status: 'FAILED',
    });
  });

  it('executes control.forEach sequentially with deterministic item and index progression', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_8',
      name: 'Sequential forEach',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_for_each',
          type: 'control.forEach',
          items: { $expr: 'payload.items' },
          itemVar: 'item',
          body: [
            {
              id: 'step_body_action',
              type: 'action.call',
              config: {
                actionId: 'ticket.update',
                version: 1,
              },
            },
          ],
        },
        {
          id: 'step_return',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: { items: ['a', 'b', 'c'] },
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_8',
          workflowId: 'wf_8',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_8',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    mockActivities.executeWorkflowRuntimeV2ActionStep.mockResolvedValue({
      output: { ok: true },
      saveAsPath: null,
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await workflowRuntimeV2RunWorkflow({
      runId: 'run_8',
      tenantId: 'tenant_1',
      workflowId: 'wf_8',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_8',
    });

    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenCalledTimes(3);
    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stepPath: 'root.steps[0].body.steps[0]',
        scopes: expect.objectContaining({
          lexical: [
            expect.objectContaining({
              item: 'a',
              index: 0,
              isFirst: true,
            }),
          ],
          workflow: expect.objectContaining({
            item: 'a',
            __forEach: {
              step_for_each: expect.objectContaining({
                index: 0,
              }),
            },
          }),
        }),
      })
    );
    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stepPath: 'root.steps[0].body.steps[0]',
        scopes: expect.objectContaining({
          lexical: [
            expect.objectContaining({
              item: 'b',
              index: 1,
              isFirst: false,
            }),
          ],
          workflow: expect.objectContaining({
            item: 'b',
            __forEach: {
              step_for_each: expect.objectContaining({
                index: 1,
              }),
            },
          }),
        }),
      })
    );
    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        stepPath: 'root.steps[0].body.steps[0]',
        scopes: expect.objectContaining({
          lexical: [
            expect.objectContaining({
              item: 'c',
              index: 2,
              isLast: true,
            }),
          ],
          workflow: expect.objectContaining({
            item: 'c',
            __forEach: {
              step_for_each: expect.objectContaining({
                index: 2,
              }),
            },
          }),
        }),
      })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_8',
      status: 'SUCCEEDED',
    });
  });

  it('advances nested control.forEach bodies correctly when the final body step is nested control flow', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_8_nested_for_each',
      name: 'Nested forEach body',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_for_each_nested',
          type: 'control.forEach',
          items: { $expr: 'payload.items' },
          itemVar: 'item',
          body: [
            {
              id: 'step_body_if',
              type: 'control.if',
              condition: { $expr: 'item = "run"' },
              then: [
                {
                  id: 'step_body_nested_action',
                  type: 'action.call',
                  config: {
                    actionId: 'ticket.update',
                    version: 1,
                  },
                },
              ],
            },
          ],
        },
        {
          id: 'step_return_nested_for_each',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: { items: ['run', 'run'] },
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_8_nested_for_each',
          workflowId: 'wf_8_nested_for_each',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_8_nested_for_each',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.executeWorkflowRuntimeV2ActionStep.mockResolvedValue({
      output: { ok: true },
      saveAsPath: null,
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await workflowRuntimeV2RunWorkflow({
      runId: 'run_8_nested_for_each',
      tenantId: 'tenant_1',
      workflowId: 'wf_8_nested_for_each',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_8_nested_for_each',
    });

    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenCalledTimes(2);
    expect(mockActivities.projectWorkflowRuntimeV2StepStart).toHaveBeenCalledWith(
      expect.objectContaining({ stepPath: 'root.steps[0].body.steps[0].then.steps[0]' })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_8_nested_for_each',
      status: 'SUCCEEDED',
    });
  });

  it('continues within control.forEach item when onItemError is continue', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_9',
      name: 'forEach onItemError continue',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_for_each',
          type: 'control.forEach',
          items: { $expr: 'payload.items' },
          itemVar: 'step_for_each',
          onItemError: 'continue',
          body: [
            {
              id: 'step_body_fail',
              type: 'action.call',
              config: {
                actionId: 'ticket.update',
                version: 1,
              },
            },
            {
              id: 'step_body_succeed',
              type: 'action.call',
              config: {
                actionId: 'ticket.update',
                version: 1,
              },
            },
          ],
        },
        {
          id: 'step_return',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: { items: ['x', 'y'] },
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_9',
          workflowId: 'wf_9',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_9',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    mockActivities.executeWorkflowRuntimeV2ActionStep
      .mockRejectedValueOnce({
        category: 'ActionError',
        message: 'first item failed',
        nodePath: 'root.steps[0].body.steps[0]',
        at: '2026-04-08T00:00:00.000Z',
      })
      .mockResolvedValueOnce({ output: { ok: true }, saveAsPath: null })
      .mockRejectedValueOnce({
        category: 'ActionError',
        message: 'second item failed',
        nodePath: 'root.steps[0].body.steps[0]',
        at: '2026-04-08T00:00:01.000Z',
      })
      .mockResolvedValueOnce({ output: { ok: true }, saveAsPath: null });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await workflowRuntimeV2RunWorkflow({
      runId: 'run_9',
      tenantId: 'tenant_1',
      workflowId: 'wf_9',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_9',
    });

    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenCalledTimes(4);
    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stepPath: 'root.steps[0].body.steps[1]',
        scopes: expect.objectContaining({
          lexical: [expect.objectContaining({ step_for_each: 'x', index: 0 })],
        }),
      })
    );
    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        stepPath: 'root.steps[0].body.steps[1]',
        scopes: expect.objectContaining({
          lexical: [expect.objectContaining({ step_for_each: 'y', index: 1 })],
        }),
      })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_9',
      status: 'SUCCEEDED',
    });
  });

  it('fails control.forEach when onItemError is fail', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_10',
      name: 'forEach onItemError fail',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_for_each',
          type: 'control.forEach',
          items: { $expr: 'payload.items' },
          itemVar: 'step_for_each',
          onItemError: 'fail',
          body: [
            {
              id: 'step_body_fail',
              type: 'action.call',
              config: {
                actionId: 'ticket.update',
                version: 1,
              },
            },
          ],
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: { items: ['x'] },
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_10',
          workflowId: 'wf_10',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_10',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    mockActivities.executeWorkflowRuntimeV2ActionStep.mockRejectedValueOnce({
      category: 'ActionError',
      message: 'item failed',
      nodePath: 'root.steps[0].body.steps[0]',
      at: '2026-04-08T00:00:00.000Z',
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_10',
      tenantId: 'tenant_1',
      workflowId: 'wf_10',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_10',
    })).rejects.toMatchObject({
      category: 'ActionError',
    });

    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_10',
      status: 'FAILED',
    });
  });

  it('executes control.callWorkflow as a Temporal child workflow', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_11',
      name: 'call workflow',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_call_workflow',
          type: 'control.callWorkflow',
          workflowId: 'wf_child',
          workflowVersion: 7,
          inputMapping: {
            ticketId: { $expr: 'payload.ticketId' },
          },
          outputMapping: {
            'vars.childTicketId': { $expr: 'childRun.vars.ticketId' },
          },
        },
        {
          id: 'step_after_child',
          type: 'action.call',
          config: {
            actionId: 'ticket.update',
            version: 1,
          },
        },
        {
          id: 'step_return',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: { ticketId: 't_123' },
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_11',
          workflowId: 'wf_11',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_11',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    mockActivities.startWorkflowRuntimeV2ChildRun.mockResolvedValue({
      childRunId: 'child-run-11',
      rootRunId: 'run_11',
      temporalWorkflowId: 'workflow-runtime-v2:run:child-run-11',
    });
    mockActivities.executeWorkflowRuntimeV2ActionStep.mockResolvedValue({
      output: { ok: true },
      saveAsPath: null,
    });

    const temporalWorkflow = await import('@temporalio/workflow');
    const executeChildMock = vi.mocked(temporalWorkflow.executeChild);
    executeChildMock.mockResolvedValueOnce({
      scopes: {
        payload: {},
        workflow: { ticketId: 't_child_11' },
        lexical: [],
        system: {
          runId: 'child-run-11',
          workflowId: 'wf_child',
          workflowVersion: 7,
          tenantId: 'tenant_1',
          definitionHash: 'child-hash-11',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await workflowRuntimeV2RunWorkflow({
      runId: 'run_11',
      tenantId: 'tenant_1',
      workflowId: 'wf_11',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_11',
    });

    expect(mockActivities.startWorkflowRuntimeV2ChildRun).toHaveBeenCalledWith(
      expect.objectContaining({
        parentRunId: 'run_11',
        parentStepPath: 'root.steps[0]',
        workflowId: 'wf_child',
        workflowVersion: 7,
        payload: {
          ticketId: 't_123',
        },
      })
    );
    expect(executeChildMock).toHaveBeenCalledTimes(1);
    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenCalledWith(
      expect.objectContaining({
        stepPath: 'root.steps[1]',
        scopes: expect.objectContaining({
          workflow: expect.objectContaining({
            childTicketId: 't_child_11',
          }),
        }),
      })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_11',
      status: 'SUCCEEDED',
    });
  });

  it('normalizes child workflow failures for parent catch/retry handling', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_12',
      name: 'call workflow failure',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_call_workflow',
          type: 'control.callWorkflow',
          workflowId: 'wf_child',
          workflowVersion: 3,
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_12',
          workflowId: 'wf_12',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_12',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    mockActivities.startWorkflowRuntimeV2ChildRun.mockResolvedValue({
      childRunId: 'child-run-12',
      rootRunId: 'run_12',
      temporalWorkflowId: 'workflow-runtime-v2:run:child-run-12',
    });

    const temporalWorkflow = await import('@temporalio/workflow');
    const executeChildMock = vi.mocked(temporalWorkflow.executeChild);
    executeChildMock.mockRejectedValueOnce(new Error('child failed'));

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_12',
      tenantId: 'tenant_1',
      workflowId: 'wf_12',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_12',
    })).rejects.toMatchObject({
      category: 'ChildWorkflowError',
    });
  });

  it('propagates cancellation during active child workflow execution and marks parent run CANCELED', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_12b',
      name: 'child cancellation propagation',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_call_workflow',
          type: 'control.callWorkflow',
          workflowId: 'wf_child',
          workflowVersion: 2,
        },
        {
          id: 'step_return',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_12b',
          workflowId: 'wf_12b',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_12b',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    mockActivities.startWorkflowRuntimeV2ChildRun.mockResolvedValue({
      childRunId: 'child-run-12b',
      rootRunId: 'run_12b',
      temporalWorkflowId: 'workflow-runtime-v2:run:child-run-12b',
    });

    const temporalWorkflow = await import('@temporalio/workflow');
    const executeChildMock = vi.mocked(temporalWorkflow.executeChild);
    executeChildMock.mockRejectedValueOnce({
      name: 'CancelledFailure',
      message: 'parent cancellation propagated to child execution',
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_12b',
      tenantId: 'tenant_1',
      workflowId: 'wf_12b',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_12b',
    })).rejects.toMatchObject({
      name: 'CancelledFailure',
    });

    expect(mockActivities.startWorkflowRuntimeV2ChildRun).toHaveBeenCalledWith(
      expect.objectContaining({
        parentRunId: 'run_12b',
        workflowId: 'wf_child',
        workflowVersion: 2,
      })
    );
    expect(mockActivities.projectWorkflowRuntimeV2StepCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run_12b',
        stepPath: 'root.steps[0]',
        status: 'CANCELED',
      })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_12b',
      status: 'CANCELED',
    });
  });

  it('retries control.callWorkflow using authored retry policy before succeeding', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_13',
      name: 'call workflow retry',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_call_workflow',
          type: 'control.callWorkflow',
          workflowId: 'wf_child',
          workflowVersion: 9,
          retry: {
            maxAttempts: 2,
            backoffMs: 1,
            backoffMultiplier: 1,
            jitter: false,
          },
        },
        {
          id: 'step_return',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_13',
          workflowId: 'wf_13',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_13',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.startWorkflowRuntimeV2ChildRun.mockResolvedValue({
      childRunId: 'child-run-13',
      rootRunId: 'run_13',
      temporalWorkflowId: 'workflow-runtime-v2:run:child-run-13',
    });

    const temporalWorkflow = await import('@temporalio/workflow');
    const executeChildMock = vi.mocked(temporalWorkflow.executeChild);
    executeChildMock
      .mockRejectedValueOnce(new Error('child transient failure'))
      .mockResolvedValueOnce({
        scopes: {
          payload: {},
          workflow: {},
          lexical: [],
          system: {
            runId: 'child-run-13',
            workflowId: 'wf_child',
            workflowVersion: 9,
            tenantId: 'tenant_1',
            definitionHash: 'hash-child-13',
            runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
          },
        },
      });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();
    await workflowRuntimeV2RunWorkflow({
      runId: 'run_13',
      tenantId: 'tenant_1',
      workflowId: 'wf_13',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_13',
    });

    expect(executeChildMock).toHaveBeenCalledTimes(2);
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_13',
      status: 'SUCCEEDED',
    });
  });

  it('routes child workflow failures into control.tryCatch catch branch', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_14',
      name: 'call workflow in tryCatch',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_try_catch',
          type: 'control.tryCatch',
          captureErrorAs: 'childError',
          try: [
            {
              id: 'step_call_workflow',
              type: 'control.callWorkflow',
              workflowId: 'wf_child',
              workflowVersion: 5,
            },
          ],
          catch: [
            {
              id: 'step_catch_action',
              type: 'action.call',
              config: {
                actionId: 'ticket.update',
                version: 1,
              },
            },
          ],
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_14',
          workflowId: 'wf_14',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_14',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.startWorkflowRuntimeV2ChildRun.mockResolvedValue({
      childRunId: 'child-run-14',
      rootRunId: 'run_14',
      temporalWorkflowId: 'workflow-runtime-v2:run:child-run-14',
    });
    mockActivities.executeWorkflowRuntimeV2ActionStep.mockResolvedValue({
      output: { ok: true },
      saveAsPath: null,
    });

    const temporalWorkflow = await import('@temporalio/workflow');
    const executeChildMock = vi.mocked(temporalWorkflow.executeChild);
    executeChildMock.mockRejectedValueOnce(new Error('child terminal failure'));

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();
    await workflowRuntimeV2RunWorkflow({
      runId: 'run_14',
      tenantId: 'tenant_1',
      workflowId: 'wf_14',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_14',
    });

    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenCalledWith(
      expect.objectContaining({
        stepPath: 'root.steps[0].catch.steps[0]',
        scopes: expect.objectContaining({
          workflow: expect.objectContaining({
            childError: expect.objectContaining({
              category: 'ChildWorkflowError',
            }),
          }),
        }),
      })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_14',
      status: 'SUCCEEDED',
    });
  });

  it('executes time.wait with Temporal sleep and wait projection lifecycle', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_15',
      name: 'time wait duration',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_wait',
          type: 'time.wait',
          config: {
            mode: 'duration',
            durationMs: 60000,
          },
        },
        {
          id: 'step_after_wait',
          type: 'action.call',
          config: {
            actionId: 'ticket.update',
            version: 1,
          },
        },
        {
          id: 'step_return',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_15',
          workflowId: 'wf_15',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_15',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.projectWorkflowRuntimeV2TimeWaitStart.mockResolvedValue({
      waitId: 'wait-15',
    });
    mockActivities.executeWorkflowRuntimeV2ActionStep.mockResolvedValue({
      output: { ok: true },
      saveAsPath: null,
    });

    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-04-08T12:00:00.000Z').getTime());
    const temporalWorkflow = await import('@temporalio/workflow');
    const sleepMock = vi.mocked(temporalWorkflow.sleep);

    try {
      const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();
      await workflowRuntimeV2RunWorkflow({
        runId: 'run_15',
        tenantId: 'tenant_1',
        workflowId: 'wf_15',
        workflowVersion: 1,
        triggerType: null,
        executionKey: 'exec_15',
      });
    } finally {
      dateNowSpy.mockRestore();
    }

    expect(mockActivities.projectWorkflowRuntimeV2TimeWaitStart).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run_15',
        stepPath: 'root.steps[0]',
        payload: expect.objectContaining({
          mode: 'duration',
          durationMs: 60000,
        }),
      })
    );
    expect(sleepMock).toHaveBeenCalledWith(60000);
    expect(mockActivities.projectWorkflowRuntimeV2TimeWaitResolved).toHaveBeenCalledWith({
      waitId: 'wait-15',
      runId: 'run_15',
      status: 'RESOLVED',
    });
    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenCalledWith(
      expect.objectContaining({
        stepPath: 'root.steps[1]',
        scopes: expect.objectContaining({
          workflow: expect.objectContaining({
            timeWait: expect.objectContaining({
              mode: 'duration',
            }),
          }),
        }),
      })
    );
  });

  it('fast-paths time.wait without sleep when dueAt is already reached', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_16',
      name: 'time wait fast path',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_wait',
          type: 'time.wait',
          config: {
            mode: 'until',
            until: { $expr: '\"2026-04-08T12:00:00.000Z\"' },
          },
        },
        {
          id: 'step_return',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_16',
          workflowId: 'wf_16',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_16',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.projectWorkflowRuntimeV2TimeWaitStart.mockResolvedValue({
      waitId: 'wait-16',
    });

    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-04-08T12:01:00.000Z').getTime());
    const temporalWorkflow = await import('@temporalio/workflow');
    const sleepMock = vi.mocked(temporalWorkflow.sleep);
    sleepMock.mockClear();

    try {
      const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();
      await workflowRuntimeV2RunWorkflow({
        runId: 'run_16',
        tenantId: 'tenant_1',
        workflowId: 'wf_16',
        workflowVersion: 1,
        triggerType: null,
        executionKey: 'exec_16',
      });
    } finally {
      dateNowSpy.mockRestore();
    }

    expect(sleepMock).not.toHaveBeenCalled();
    expect(mockActivities.projectWorkflowRuntimeV2TimeWaitResolved).toHaveBeenCalledWith({
      waitId: 'wait-16',
      runId: 'run_16',
      status: 'RESOLVED',
    });
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_16',
      status: 'SUCCEEDED',
    });
  });

  it('marks active waits as CANCELED when Temporal cancellation interrupts a wait', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_16_cancel_wait',
      name: 'time wait cancellation cleanup',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_wait',
          type: 'time.wait',
          config: {
            mode: 'duration',
            durationMs: 60000,
          },
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_16_cancel_wait',
          workflowId: 'wf_16_cancel_wait',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_16_cancel_wait',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.projectWorkflowRuntimeV2TimeWaitStart.mockResolvedValue({
      waitId: 'wait-16-cancel',
    });

    const temporalWorkflow = await import('@temporalio/workflow');
    const sleepMock = vi.mocked(temporalWorkflow.sleep);
    sleepMock.mockRejectedValueOnce({
      name: 'CancelledFailure',
      message: 'workflow cancelled while sleeping',
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();

    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_16_cancel_wait',
      tenantId: 'tenant_1',
      workflowId: 'wf_16_cancel_wait',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_16_cancel_wait',
    })).rejects.toMatchObject({
      name: 'CancelledFailure',
    });

    expect(mockActivities.projectWorkflowRuntimeV2TimeWaitResolved).toHaveBeenCalledWith({
      waitId: 'wait-16-cancel',
      runId: 'run_16_cancel_wait',
      status: 'CANCELED',
    });
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_16_cancel_wait',
      status: 'CANCELED',
    });
  });

  it('resumes event.wait from a matching workflow signal and projects wait resolution', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_17',
      name: 'event wait signal',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_event_wait',
          type: 'event.wait',
          config: {
            eventName: 'ticket.updated',
            correlationKey: { $expr: 'payload.ticketId' },
            filters: [
              { path: 'status', op: '=', value: 'done' },
            ],
            timeoutMs: 60000,
          },
        },
        {
          id: 'step_after_event',
          type: 'action.call',
          config: {
            actionId: 'ticket.update',
            version: 1,
          },
        },
        {
          id: 'step_return',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: { ticketId: 't_17' },
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_17',
          workflowId: 'wf_17',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_17',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.projectWorkflowRuntimeV2EventWaitStart.mockResolvedValue({
      waitId: 'wait-event-17',
    });
    mockActivities.executeWorkflowRuntimeV2ActionStep.mockResolvedValue({
      output: { ok: true },
      saveAsPath: null,
    });

    const temporalWorkflow = await import('@temporalio/workflow');
    const conditionMock = vi.mocked(temporalWorkflow.condition);
    conditionMock.mockImplementationOnce(async (predicate: () => boolean) => {
      const handler = workflowSignalHandlers.get('workflowRuntimeV2Event');
      handler?.({
        eventId: 'event-17',
        eventName: 'ticket.updated',
        correlationKey: 't_17',
        payload: {
          status: 'done',
          source: 'test',
        },
        receivedAt: '2026-04-08T12:00:00.000Z',
      });
      return predicate();
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();
    await workflowRuntimeV2RunWorkflow({
      runId: 'run_17',
      tenantId: 'tenant_1',
      workflowId: 'wf_17',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_17',
    });

    expect(mockActivities.projectWorkflowRuntimeV2EventWaitStart).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run_17',
        stepPath: 'root.steps[0]',
        eventName: 'ticket.updated',
        correlationKey: 't_17',
      })
    );
    expect(mockActivities.projectWorkflowRuntimeV2EventWaitResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        waitId: 'wait-event-17',
        runId: 'run_17',
        status: 'RESOLVED',
        matchedEventId: 'event-17',
      })
    );
    expect(mockActivities.executeWorkflowRuntimeV2ActionStep).toHaveBeenCalledWith(
      expect.objectContaining({
        stepPath: 'root.steps[1]',
        scopes: expect.objectContaining({
          workflow: expect.objectContaining({
            eventName: 'ticket.updated',
            event: expect.objectContaining({
              status: 'done',
            }),
          }),
        }),
      })
    );
  });

  it('raises a catchable TimeoutError when event.wait does not receive a matching signal in time', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_18',
      name: 'event wait timeout',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_event_wait',
          type: 'event.wait',
          config: {
            eventName: 'ticket.updated',
            correlationKey: { $expr: 'payload.ticketId' },
            timeoutMs: 1,
          },
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: { ticketId: 't_18' },
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_18',
          workflowId: 'wf_18',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_18',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.projectWorkflowRuntimeV2EventWaitStart.mockResolvedValue({
      waitId: 'wait-event-18',
    });

    const temporalWorkflow = await import('@temporalio/workflow');
    const conditionMock = vi.mocked(temporalWorkflow.condition);
    conditionMock.mockResolvedValueOnce(false);

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();
    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_18',
      tenantId: 'tenant_1',
      workflowId: 'wf_18',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_18',
    })).rejects.toMatchObject({
      category: 'TimeoutError',
    });

    expect(mockActivities.projectWorkflowRuntimeV2EventWaitResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        waitId: 'wait-event-18',
        runId: 'run_18',
        status: 'RESOLVED',
      })
    );
  });

  it('resumes human.task from matching task signal and validates response before continuing', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_19',
      name: 'human task',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_human_task',
          type: 'human.task',
          config: {
            taskType: 'approval',
            title: { $expr: '\"Approve request\"' },
            assign: {
              'vars.approval': { $expr: 'vars.event.approved' },
            },
          },
        },
        {
          id: 'step_return',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_19',
          workflowId: 'wf_19',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_19',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.startWorkflowRuntimeV2HumanTaskWait.mockResolvedValue({
      waitId: 'wait-human-19',
      taskId: 'task-19',
      eventName: 'HUMAN_TASK_COMPLETED',
    });

    const temporalWorkflow = await import('@temporalio/workflow');
    const conditionMock = vi.mocked(temporalWorkflow.condition);
    conditionMock.mockImplementationOnce(async (predicate: () => boolean) => {
      const handler = workflowSignalHandlers.get('workflowRuntimeV2HumanTask');
      handler?.({
        taskId: 'task-19',
        eventName: 'HUMAN_TASK_COMPLETED',
        payload: {
          approved: true,
        },
      });
      return predicate();
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();
    await workflowRuntimeV2RunWorkflow({
      runId: 'run_19',
      tenantId: 'tenant_1',
      workflowId: 'wf_19',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_19',
    });

    expect(mockActivities.startWorkflowRuntimeV2HumanTaskWait).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run_19',
        stepPath: 'root.steps[0]',
        taskType: 'approval',
      })
    );
    expect(mockActivities.validateWorkflowRuntimeV2HumanTaskResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant_1',
        taskType: 'approval',
        eventName: 'HUMAN_TASK_COMPLETED',
        payload: expect.objectContaining({
          approved: true,
        }),
      })
    );
    expect(mockActivities.resolveWorkflowRuntimeV2HumanTaskWait).toHaveBeenCalledWith(
      expect.objectContaining({
        waitId: 'wait-human-19',
        runId: 'run_19',
        status: 'RESOLVED',
      })
    );
  });

  it('fails human.task when response validation activity rejects payload', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_20',
      name: 'human task invalid response',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_human_task',
          type: 'human.task',
          config: {
            taskType: 'approval',
            title: { $expr: '\"Approve request\"' },
          },
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_20',
          workflowId: 'wf_20',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_20',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.startWorkflowRuntimeV2HumanTaskWait.mockResolvedValue({
      waitId: 'wait-human-20',
      taskId: 'task-20',
      eventName: 'HUMAN_TASK_COMPLETED',
    });
    mockActivities.validateWorkflowRuntimeV2HumanTaskResponse.mockRejectedValueOnce({
      category: 'ValidationError',
      message: 'Human task response validation failed: [{\"path\":\"approved\"}]',
      nodePath: 'human.task',
      at: '2026-04-08T00:00:00.000Z',
    });

    const temporalWorkflow = await import('@temporalio/workflow');
    const conditionMock = vi.mocked(temporalWorkflow.condition);
    conditionMock.mockImplementationOnce(async (predicate: () => boolean) => {
      const handler = workflowSignalHandlers.get('workflowRuntimeV2HumanTask');
      handler?.({
        taskId: 'task-20',
        eventName: 'HUMAN_TASK_COMPLETED',
        payload: {
          approved: 'yes',
        },
      });
      return predicate();
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();
    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_20',
      tenantId: 'tenant_1',
      workflowId: 'wf_20',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_20',
    })).rejects.toMatchObject({
      category: 'ValidationError',
    });
  });

  it('registers runtime query handlers for current step, wait, and interpreter summary', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_21',
      name: 'query handlers',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_return',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_21',
          workflowId: 'wf_21',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_21',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();
    await workflowRuntimeV2RunWorkflow({
      runId: 'run_21',
      tenantId: 'tenant_1',
      workflowId: 'wf_21',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_21',
    });

    expect(workflowSignalHandlers.has('workflowRuntimeV2CurrentStep')).toBe(true);
    expect(workflowSignalHandlers.has('workflowRuntimeV2CurrentWait')).toBe(true);
    expect(workflowSignalHandlers.has('workflowRuntimeV2InterpreterSummary')).toBe(true);

    const currentStepQuery = workflowSignalHandlers.get('workflowRuntimeV2CurrentStep');
    const currentWaitQuery = workflowSignalHandlers.get('workflowRuntimeV2CurrentWait');
    const summaryQuery = workflowSignalHandlers.get('workflowRuntimeV2InterpreterSummary');

    expect(currentStepQuery?.({})).toEqual(
      expect.objectContaining({
        runId: 'run_21',
      })
    );
    expect(currentWaitQuery?.({})).toBeNull();
    expect(summaryQuery?.({})).toEqual(
      expect.objectContaining({
        runId: 'run_21',
        stepCount: expect.any(Number),
      })
    );
  });

  it('continues as new with an interpreter checkpoint at the configured step interval', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_22',
      name: 'continue as new checkpoint',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_action_1',
          type: 'action.call',
          config: {
            actionId: 'ticket.update',
            version: 1,
          },
        },
        {
          id: 'step_action_2',
          type: 'action.call',
          config: {
            actionId: 'ticket.update',
            version: 1,
          },
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_22',
          workflowId: 'wf_22',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_22',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.executeWorkflowRuntimeV2ActionStep.mockResolvedValue({
      output: { ok: true },
      saveAsPath: null,
    });

    const temporalWorkflow = await import('@temporalio/workflow');
    const continueAsNewMock = vi.mocked(temporalWorkflow.continueAsNew);
    continueAsNewMock.mockImplementationOnce(async () => {
      throw new Error('continue-as-new checkpoint');
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();
    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_22',
      tenantId: 'tenant_1',
      workflowId: 'wf_22',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_22',
      checkpoint: {
        stepCount: 249,
        state: {
          runId: 'run_22',
          currentStepPath: 'root.steps[0]',
          scopes: {
            payload: {},
            workflow: {},
            lexical: [],
            system: {
              runId: 'run_22',
              workflowId: 'wf_22',
              workflowVersion: 1,
              tenantId: 'tenant_1',
              definitionHash: 'hash_22',
              runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
            },
          },
          frames: [
            {
              kind: 'sequence',
              path: 'root.steps',
              nextIndex: 0,
              totalSteps: 2,
            },
          ],
        },
      },
    })).rejects.toThrow('continue-as-new checkpoint');

    expect(continueAsNewMock).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run_22',
      workflowId: 'wf_22',
      workflowVersion: 1,
      executionKey: 'exec_22',
      checkpoint: expect.objectContaining({
        stepCount: 250,
      }),
    }));
  });

  it('replays from a continue-as-new checkpoint with canonical control.if expressions without drift', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_23',
      name: 'replay checkpoint parity',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_if',
          type: 'control.if',
          condition: { $expr: 'nowIso() != ""' },
          then: [{ id: 'step_then_action', type: 'action.call', config: { actionId: 'ticket.update', version: 1 } }],
          else: [{ id: 'step_else_return', type: 'control.return' }],
        },
        {
          id: 'step_return',
          type: 'control.return',
        },
      ],
    };

    mockActivities.loadWorkflowRuntimeV2PinnedDefinition.mockResolvedValue({
      definition,
      initialScopes: {
        payload: {},
        workflow: {},
        lexical: [],
        system: {
          runId: 'run_23',
          workflowId: 'wf_23',
          workflowVersion: 1,
          tenantId: 'tenant_1',
          definitionHash: 'hash_23',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });
    mockActivities.executeWorkflowRuntimeV2ActionStep.mockResolvedValue({
      output: { ok: true },
      saveAsPath: null,
    });

    const temporalWorkflow = await import('@temporalio/workflow');
    const continueAsNewMock = vi.mocked(temporalWorkflow.continueAsNew);
    continueAsNewMock.mockImplementationOnce(async () => {
      throw new Error('checkpoint-captured');
    });

    const { workflowRuntimeV2RunWorkflow } = await loadWorkflow();
    let capturedCheckpoint: unknown = null;
    await expect(workflowRuntimeV2RunWorkflow({
      runId: 'run_23',
      tenantId: 'tenant_1',
      workflowId: 'wf_23',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_23',
      checkpoint: {
        stepCount: 249,
        state: {
          runId: 'run_23',
          currentStepPath: 'root.steps[0]',
          scopes: {
            payload: {},
            workflow: {},
            lexical: [],
            system: {
              runId: 'run_23',
              workflowId: 'wf_23',
              workflowVersion: 1,
              tenantId: 'tenant_1',
              definitionHash: 'hash_23',
              runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
            },
          },
          frames: [
            {
              kind: 'sequence',
              path: 'root.steps',
              nextIndex: 0,
              totalSteps: 2,
            },
          ],
        },
      },
    })).rejects.toThrow('checkpoint-captured');

    const firstCall = continueAsNewMock.mock.calls[0]?.[0] as { checkpoint?: unknown } | undefined;
    capturedCheckpoint = firstCall?.checkpoint ?? null;
    expect(capturedCheckpoint).toBeTruthy();

    continueAsNewMock.mockReset();
    const replayResult = await workflowRuntimeV2RunWorkflow({
      runId: 'run_23',
      tenantId: 'tenant_1',
      workflowId: 'wf_23',
      workflowVersion: 1,
      triggerType: null,
      executionKey: 'exec_23',
      checkpoint: capturedCheckpoint as {
        state: {
          runId: string;
          currentStepPath: string | null;
          scopes: unknown;
          frames: unknown[];
        };
        stepCount: number;
      },
    });

    expect(replayResult).toMatchObject({
      scopes: expect.objectContaining({
        payload: {},
      }),
    });
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_23',
      status: 'SUCCEEDED',
    });
  });
});
