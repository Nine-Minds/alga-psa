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
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: mocks.getAdminConnection,
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
  WorkflowRunStepModelV2: {},
  WorkflowRunModelV2: {},
  WorkflowRunWaitModelV2: {},
  WorkflowTaskModel: {},
  WorkflowTaskStatus: {
    PENDING: 'PENDING',
  },
}));

describe('workflow-runtime-v2 activities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminConnection.mockResolvedValue({});
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
});
