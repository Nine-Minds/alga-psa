import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminConnection: vi.fn(),
  findInvocationByIdempotency: vi.fn(),
  createInvocation: vi.fn(),
  updateInvocation: vi.fn(),
  initializeWorkflowRuntimeV2: vi.fn(),
  resolveInputMapping: vi.fn(),
  resolveExpressionsWithSecrets: vi.fn(),
  actionRegistryGet: vi.fn(),
  actionHandler: vi.fn(),
  getRunById: vi.fn(),
  getLatestStepByPath: vi.fn(),
  createRunStep: vi.fn(),
  updateRun: vi.fn(),
  createWait: vi.fn(),
  updateWait: vi.fn(),
  reserveStepStart: vi.fn(),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: mocks.getAdminConnection,
  retryOnAdminReadOnly: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('@alga-psa/workflows/runtime/core', () => ({
  WorkflowRuntimeV2: class WorkflowRuntimeV2 {},
  workflowDefinitionSchema: {
    parse: (value: unknown) => value,
  },
  resolveInputMapping: mocks.resolveInputMapping,
  resolveExpressionsWithSecrets: mocks.resolveExpressionsWithSecrets,
  getActionRegistryV2: () => ({
    get: mocks.actionRegistryGet,
  }),
  getNodeTypeRegistry: () => ({
    get: vi.fn(),
  }),
  generateIdempotencyKey: () => 'generated-idempotency-key',
  initializeWorkflowRuntimeV2: mocks.initializeWorkflowRuntimeV2,
  createSecretResolverFromProvider: (provider: unknown) => provider,
  workflowStepQuotaService: {
    reserveStepStart: mocks.reserveStepStart,
  },
}));

vi.mock('@alga-psa/shared/workflow/secrets', () => ({
  createTenantSecretProvider: () => ({
    getValue: vi.fn(),
  }),
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowActionInvocationModelV2: {
    findByIdempotency: mocks.findInvocationByIdempotency,
    create: mocks.createInvocation,
    update: mocks.updateInvocation,
  },
  WorkflowDefinitionVersionModelV2: {},
  WorkflowRunStepModelV2: {
    getLatestByRunAndPath: mocks.getLatestStepByPath,
    create: mocks.createRunStep,
  },
  WorkflowRunModelV2: {
    getById: mocks.getRunById,
    update: mocks.updateRun,
  },
  WorkflowRunWaitModelV2: {
    create: mocks.createWait,
    update: mocks.updateWait,
  },
  WorkflowTaskModel: {},
  WorkflowTaskStatus: {
    PENDING: 'PENDING',
  },
}));

describe('workflow-runtime-v2 activities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const waitsQuery = {
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
    };
    const knex = ((table: string) => {
      if (table === 'workflow_run_waits') return waitsQuery;
      throw new Error(`Unexpected table ${table}`);
    }) as any;
    mocks.getAdminConnection.mockResolvedValue(knex);
    mocks.resolveInputMapping.mockResolvedValue({});
    mocks.resolveExpressionsWithSecrets.mockResolvedValue(null);
    mocks.findInvocationByIdempotency.mockResolvedValue(null);
    mocks.createInvocation.mockResolvedValue({
      invocation_id: 'invocation-1',
      attempt: 1,
    });
    mocks.updateInvocation.mockResolvedValue(undefined);
    mocks.actionHandler.mockResolvedValue({
      title_text: 'rendered compose output',
    });
    mocks.actionRegistryGet.mockReturnValue({
      inputSchema: {
        parse: (value: unknown) => value,
      },
      outputSchema: {
        parse: (value: unknown) => value,
      },
      handler: mocks.actionHandler,
    });
    mocks.getRunById.mockResolvedValue({
      run_id: 'run-1',
      tenant_id: 'tenant-1',
    });
    mocks.getLatestStepByPath.mockResolvedValue(null);
    mocks.createRunStep.mockResolvedValue({ step_id: 'step-1' });
    mocks.updateRun.mockResolvedValue(undefined);
    mocks.createWait.mockResolvedValue({ wait_id: 'wait-1' });
    mocks.updateWait.mockResolvedValue(undefined);
    mocks.reserveStepStart.mockResolvedValue({
      allowed: true,
      summary: {
        tenant: 'tenant-1',
        periodStart: '2026-04-01T00:00:00.000Z',
        periodEnd: '2026-05-01T00:00:00.000Z',
        periodSource: 'fallback_calendar',
        stripeSubscriptionId: null,
        effectiveLimit: 750,
        usedCount: 1,
        remaining: 749,
        tier: 'pro',
        limitSource: 'tier_default',
      },
      usedCountAfter: 1,
    });
  });

  it('preserves raw action config as stepConfig for transform.compose_text outputs', async () => {
    const { executeWorkflowRuntimeV2ActionStep } = await import('../workflow-runtime-v2-activities');

    const rawConfig = {
      actionId: 'transform.compose_text',
      version: 1,
      saveAs: 'vars.composeResult',
      outputs: [
        {
          id: 'output-title',
          label: 'Title Text',
          stableKey: 'title_text',
          document: {
            version: 1,
            blocks: [
              {
                type: 'paragraph',
                children: [{ type: 'text', text: 'Created at ' }],
              },
            ],
          },
        },
      ],
    };

    const result = await executeWorkflowRuntimeV2ActionStep({
      runId: 'run-compose-text',
      stepPath: 'root.steps[1]',
      stepId: 'step-compose-text',
      tenantId: 'tenant-1',
      step: {
        type: 'action.call',
        config: rawConfig,
      },
      scopes: {
        payload: {},
        workflow: {},
        lexical: [],
        meta: {},
        error: null,
        system: {
          runId: 'run-compose-text',
          workflowId: 'workflow-1',
          workflowVersion: 3,
          tenantId: 'tenant-1',
          definitionHash: 'definition-hash',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    });

    expect(result).toEqual({
      output: {
        title_text: 'rendered compose output',
      },
      saveAsPath: 'vars.composeResult',
    });
    expect(mocks.actionHandler).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        stepConfig: rawConfig,
      }),
    );
    expect(mocks.updateInvocation).toHaveBeenCalledWith(
      expect.anything(),
      'invocation-1',
      expect.objectContaining({
        status: 'SUCCEEDED',
        output_json: {
          title_text: 'rendered compose output',
        },
      }),
    );
  });

  it('projects STARTED step only after successful quota reservation', async () => {
    const { projectWorkflowRuntimeV2StepStart } = await import('../workflow-runtime-v2-activities');
    const result = await projectWorkflowRuntimeV2StepStart({
      runId: 'run-1',
      stepPath: 'root.steps[0]',
      definitionStepId: 'step-a',
    });
    expect(mocks.reserveStepStart).toHaveBeenCalledWith(expect.anything(), 'tenant-1');
    expect(mocks.createRunStep).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        run_id: 'run-1',
        step_path: 'root.steps[0]',
        definition_step_id: 'step-a',
        status: 'STARTED',
        attempt: 1,
      }),
    );
    expect(result).toEqual({ stepId: 'step-1' });
  });

  it('returns quotaPaused and does not create STARTED row when reservation is denied', async () => {
    mocks.reserveStepStart.mockResolvedValueOnce({
      allowed: false,
      summary: {
        tenant: 'tenant-1',
        periodStart: '2026-04-01T00:00:00.000Z',
        periodEnd: '2026-05-01T00:00:00.000Z',
        periodSource: 'fallback_calendar',
        stripeSubscriptionId: null,
        effectiveLimit: 1,
        usedCount: 1,
        remaining: 0,
        tier: 'pro',
        limitSource: 'tier_default',
      },
    });
    const { projectWorkflowRuntimeV2StepStart } = await import('../workflow-runtime-v2-activities');
    const result = await projectWorkflowRuntimeV2StepStart({
      runId: 'run-1',
      stepPath: 'root.steps[0]',
      definitionStepId: 'step-a',
    });
    expect(result).toEqual({ stepId: null, quotaPaused: true });
    expect(mocks.createRunStep).not.toHaveBeenCalled();
    expect(mocks.createWait).toHaveBeenCalled();
  });
});
