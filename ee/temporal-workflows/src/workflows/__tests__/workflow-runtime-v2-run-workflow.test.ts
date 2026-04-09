import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime';

type RuntimeV2Activities = {
  loadWorkflowRuntimeV2PinnedDefinition: ReturnType<typeof vi.fn>;
  executeWorkflowRuntimeV2Run: ReturnType<typeof vi.fn>;
  projectWorkflowRuntimeV2StepStart: ReturnType<typeof vi.fn>;
  projectWorkflowRuntimeV2StepCompletion: ReturnType<typeof vi.fn>;
  executeWorkflowRuntimeV2ActionStep: ReturnType<typeof vi.fn>;
  startWorkflowRuntimeV2ChildRun: ReturnType<typeof vi.fn>;
  completeWorkflowRuntimeV2Run: ReturnType<typeof vi.fn>;
};

let mockActivities: RuntimeV2Activities;

vi.mock('@temporalio/workflow', () => ({
  continueAsNew: vi.fn(async () => undefined),
  executeChild: vi.fn(async () => undefined),
  proxyActivities: vi.fn(() => mockActivities),
  sleep: vi.fn(async () => undefined),
}));

const loadWorkflow = async () => {
  vi.resetModules();
  return import('../workflow-runtime-v2-run-workflow.js');
};

describe('workflowRuntimeV2RunWorkflow', () => {
  beforeEach(() => {
    let stepCounter = 0;
    mockActivities = {
      loadWorkflowRuntimeV2PinnedDefinition: vi.fn(),
      executeWorkflowRuntimeV2Run: vi.fn(),
      projectWorkflowRuntimeV2StepStart: vi.fn(),
      projectWorkflowRuntimeV2StepCompletion: vi.fn(),
      executeWorkflowRuntimeV2ActionStep: vi.fn(),
      startWorkflowRuntimeV2ChildRun: vi.fn(),
      completeWorkflowRuntimeV2Run: vi.fn(),
    };

    mockActivities.projectWorkflowRuntimeV2StepStart.mockImplementation(async () => {
      stepCounter += 1;
      return { stepId: `step-${stepCounter}` };
    });
    mockActivities.completeWorkflowRuntimeV2Run.mockResolvedValue(undefined);
    mockActivities.projectWorkflowRuntimeV2StepCompletion.mockResolvedValue(undefined);
    mockActivities.executeWorkflowRuntimeV2Run.mockResolvedValue(undefined);
    mockActivities.startWorkflowRuntimeV2ChildRun.mockResolvedValue({
      childRunId: 'child-run-default',
      rootRunId: 'root-run-default',
      temporalWorkflowId: 'workflow-runtime-v2:run:child-run-default',
    });
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

  it('fails control.if when expression uses nowIso()', async () => {
    const definition: WorkflowDefinition = {
      id: 'wf_3',
      name: 'Non deterministic if',
      version: 1,
      payloadSchemaRef: 'payload.test.v1',
      steps: [
        {
          id: 'step_if',
          type: 'control.if',
          condition: { $expr: 'nowIso() = \"2026-01-01T00:00:00.000Z\"' },
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
    })).rejects.toThrow('nowIso');

    expect(mockActivities.projectWorkflowRuntimeV2StepCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run_3',
        status: 'FAILED',
      })
    );
    expect(mockActivities.completeWorkflowRuntimeV2Run).toHaveBeenCalledWith({
      runId: 'run_3',
      status: 'FAILED',
    });
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

    const temporalWorkflow = await import('@temporalio/workflow');
    const executeChildMock = vi.mocked(temporalWorkflow.executeChild);
    executeChildMock.mockResolvedValueOnce(undefined);

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
});
