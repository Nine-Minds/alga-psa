import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminConnection: vi.fn(),
  findInvocationByIdempotency: vi.fn(),
  createInvocation: vi.fn(),
  claimFailed: vi.fn(),
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

vi.mock('@alga-psa/workflows/runtime/core', async () => {
  const { applyRedactions, safeSerialize } = await import('@alga-psa/shared/workflow/runtime/utils/redactionUtils');
  return {
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
    applyRedactions,
    safeSerialize,
    workflowStepQuotaService: {
      reserveStepStart: mocks.reserveStepStart,
    },
  };
});

vi.mock('@alga-psa/shared/workflow/secrets', () => ({
  createTenantSecretProvider: () => ({
    getValue: vi.fn(),
  }),
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowActionInvocationModelV2: {
    findByIdempotency: mocks.findInvocationByIdempotency,
    create: mocks.createInvocation,
    claimFailed: mocks.claimFailed,
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
    mocks.claimFailed.mockResolvedValue(null);
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
      tenant: 'tenant-1',
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

  it.each([
    ['comment-existing-ticket', 'message-1:ticket-1', { ticketId: 'ticket-1', author_type: 'contact', source: 'email' }],
    ['create-ticket-with-comment', 'provider-1:message-1', { targetClientId: 'client-1', ticketDefaults: { board_id: 'board-1' } }],
    ['attachments-new-ticket', 'message-1:new-ticket:attachments', { ticketId: 'new-ticket', emailId: 'message-1', providerId: 'provider-1', tenant: 'tenant-1', attachments: [] }],
  ] as const)('resolves shipped email %s inputs and replays its tenant-scoped idempotency key', async (stepId, key, expectedArgs) => {
    const resolvers = await import('@alga-psa/shared/workflow/runtime/utils/mappingResolver');
    mocks.resolveInputMapping.mockImplementation(resolvers.resolveInputMapping);
    mocks.resolveExpressionsWithSecrets.mockImplementation(resolvers.resolveExpressionsWithSecrets);
    const definition = JSON.parse(readFileSync(path.resolve(__dirname,
      '../../../../../shared/workflow/runtime/workflows/email-processing-workflow.v2.json'), 'utf8'));
    const findStep = (value: any): any => {
      if (!value || typeof value !== 'object') return undefined;
      if (value.id === stepId) return value;
      for (const child of Object.values(value)) {
        const found = findStep(child);
        if (found) return found;
      }
    };
    const step = findStep(definition);
    expect(step).toBeDefined();
    const { executeWorkflowRuntimeV2ActionStep } = await import('../workflow-runtime-v2-activities');
    const scopes: any = {
      payload: { tenantId: 'tenant-1', providerId: 'provider-1', emailData: { id: 'message-1', attachments: [], from: { email: 'sender@example.com' } } },
      workflow: { parsedEmail: { sanitizedText: 'Please help' }, existingTicketResolution: { ticket: { ticketId: 'ticket-1' } },
        ticketContext: { targetClientId: 'client-1', targetContactId: null, targetAuthorUserId: null, targetLocationId: null, ticketDefaults: { board_id: 'board-1' } }, createdTicket: { ticket_id: 'new-ticket' } },
      lexical: [], meta: {}, error: null,
      system: { runId: 'run-email', workflowId: definition.id, workflowVersion: definition.version, tenantId: 'tenant-1' },
    };
    const input = { runId: 'run-email', stepPath: 'root.steps[0]', stepId, tenantId: 'tenant-1', step, scopes };
    mocks.actionHandler.mockResolvedValue({ result: 'persisted-result' });
    await executeWorkflowRuntimeV2ActionStep(input);
    expect(mocks.actionHandler).toHaveBeenCalledWith(expect.objectContaining(expectedArgs), expect.objectContaining({ idempotencyKey: `tenant-1:${key}`, tenantId: 'tenant-1' }));
    expect(mocks.createInvocation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ idempotency_key: `tenant-1:${key}` }));
    mocks.findInvocationByIdempotency.mockResolvedValue({ status: 'SUCCEEDED', output_json: { result: 'persisted-result' } });
    const replay = await executeWorkflowRuntimeV2ActionStep({ ...input, runId: 'retry-run' });
    expect(replay.output).toEqual({ result: 'persisted-result' });
    expect(mocks.actionHandler).toHaveBeenCalledOnce();
    expect(mocks.createInvocation).toHaveBeenCalledOnce();
    expect(mocks.findInvocationByIdempotency).toHaveBeenLastCalledWith(expect.anything(), step.config.actionId, 1, `tenant-1:${key}`, 'tenant-1');
  });

  it.each([true, false])('executes a failed retry only when the atomic claim succeeds: %s', async (claimed) => {
    mocks.findInvocationByIdempotency.mockResolvedValue({ invocation_id: 'failed-invocation', status: 'FAILED', error_json: { message: 'Previous failure' } });
    mocks.claimFailed.mockResolvedValue(claimed ? { invocation_id: 'failed-invocation', attempt: 2 } : null);
    const { executeWorkflowRuntimeV2ActionStep } = await import('../workflow-runtime-v2-activities');
    const execution = executeWorkflowRuntimeV2ActionStep({
      runId: 'retry-run', stepPath: 'root.steps[0]', stepId: 'step', tenantId: 'tenant-1',
      step: { type: 'action.call', config: { actionId: 'email-test', version: 1 } },
      scopes: { payload: {}, workflow: {}, lexical: [], meta: {}, error: null,
        system: { runId: 'retry-run', workflowId: 'workflow', workflowVersion: 1, tenantId: 'tenant-1', definitionHash: null, runtimeSemanticsVersion: null } },
    });
    if (claimed) {
      await execution;
      expect(mocks.actionHandler).toHaveBeenCalledWith({}, expect.objectContaining({ attempt: 2 }));
      expect(mocks.updateInvocation).toHaveBeenCalledWith(expect.anything(), 'failed-invocation', expect.objectContaining({ status: 'SUCCEEDED', error_json: null }), 'tenant-1');
    } else {
      await expect(execution).rejects.toThrow('already in progress');
      expect(mocks.actionHandler).not.toHaveBeenCalled();
    }
    expect(mocks.createInvocation).not.toHaveBeenCalled();
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
      'tenant-1',
    );
    // error_json must stay out of non-failure writes: the worker can deploy
    // ahead of the migration that adds the column.
    expect(mocks.updateInvocation.mock.calls[0][2]).not.toHaveProperty('error_json');
    expect(mocks.createInvocation.mock.calls[0][1]).not.toHaveProperty('error_json');
  });

  it('falls back to a plain failure update when error_json column is missing (42703)', async () => {
    const { executeWorkflowRuntimeV2ActionStep } = await import('../workflow-runtime-v2-activities');

    mocks.actionHandler.mockRejectedValueOnce(new Error('boom'));
    mocks.updateInvocation.mockImplementationOnce(async () => {
      const undefinedColumn = new Error('column "error_json" of relation "workflow_action_invocations" does not exist');
      (undefinedColumn as Error & { code?: string }).code = '42703';
      throw undefinedColumn;
    });

    await expect(
      executeWorkflowRuntimeV2ActionStep({
        runId: 'run-migration-lag',
        stepPath: 'root.steps[1]',
        stepId: 'step-migration-lag',
        tenantId: 'tenant-1',
        step: {
          type: 'action.call',
          config: {
            actionId: 'integration.call',
            version: 1,
          },
        },
        scopes: {
          payload: {},
          workflow: {},
          lexical: [],
          meta: {},
          error: null,
          system: {
            runId: 'run-migration-lag',
            workflowId: 'workflow-1',
            workflowVersion: 3,
            tenantId: 'tenant-1',
            definitionHash: 'definition-hash',
            runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
          },
        },
      }),
    ).rejects.toMatchObject({ message: 'boom' });

    expect(mocks.updateInvocation).toHaveBeenCalledTimes(2);
    const retryPayload = mocks.updateInvocation.mock.calls[1][2];
    expect(retryPayload).toMatchObject({ status: 'FAILED', error_message: 'boom' });
    expect(retryPayload).not.toHaveProperty('error_json');
  });

  it('persists normalized structured error_json while keeping error_message unchanged', async () => {
    const { executeWorkflowRuntimeV2ActionStep } = await import('../workflow-runtime-v2-activities');

    mocks.actionHandler.mockRejectedValueOnce({
      category: 'IntegrationError',
      code: 'RATE_LIMITED',
      message: 'Provider rate limit exceeded',
      details: {
        apiKey: 'plain-secret',
        secretRef: 'provider-secret',
        nested: {
          token: 'nested-token',
          stack: 'nested stack',
        },
        stack: 'top stack',
      },
      nodePath: 'root.steps[2]',
      at: '2026-07-16T12:00:00.000Z',
    });

    await expect(executeWorkflowRuntimeV2ActionStep({
      runId: 'run-failed-action',
      stepPath: 'root.steps[1]',
      stepId: 'step-failed-action',
      tenantId: 'tenant-1',
      step: {
        type: 'action.call',
        config: {
          actionId: 'integration.call',
          version: 1,
        },
      },
      scopes: {
        payload: {},
        workflow: {},
        lexical: [],
        meta: {},
        error: null,
        system: {
          runId: 'run-failed-action',
          workflowId: 'workflow-1',
          workflowVersion: 3,
          tenantId: 'tenant-1',
          definitionHash: 'definition-hash',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    })).rejects.toMatchObject({
      category: 'IntegrationError',
      code: 'RATE_LIMITED',
      message: 'Provider rate limit exceeded',
    });

    expect(mocks.updateInvocation).toHaveBeenCalledWith(
      expect.anything(),
      'invocation-1',
      expect.objectContaining({
        status: 'FAILED',
        error_message: 'Provider rate limit exceeded',
        error_json: {
          category: 'IntegrationError',
          code: 'RATE_LIMITED',
          message: 'Provider rate limit exceeded',
          nodePath: 'root.steps[2]',
          at: '2026-07-16T12:00:00.000Z',
          details: {
            apiKey: '[REDACTED]',
            secretRef: '[REDACTED]',
            nested: {
              token: '[REDACTED]',
            },
          },
        },
      }),
      'tenant-1',
    );
  });

  it('truncates oversized structured error details', async () => {
    const { executeWorkflowRuntimeV2ActionStep } = await import('../workflow-runtime-v2-activities');

    mocks.actionHandler.mockRejectedValueOnce({
      category: 'ActionError',
      code: 'INTERNAL_ERROR',
      message: 'Large failure',
      details: {
        body: 'x'.repeat(40 * 1024),
      },
      nodePath: 'root.steps[1]',
      at: '2026-07-16T12:00:00.000Z',
    });

    await expect(executeWorkflowRuntimeV2ActionStep({
      runId: 'run-large-error',
      stepPath: 'root.steps[1]',
      stepId: 'step-large-error',
      tenantId: 'tenant-1',
      step: {
        type: 'action.call',
        config: {
          actionId: 'integration.call',
          version: 1,
        },
      },
      scopes: {
        payload: {},
        workflow: {},
        lexical: [],
        meta: {},
        error: null,
        system: {
          runId: 'run-large-error',
          workflowId: 'workflow-1',
          workflowVersion: 3,
          tenantId: 'tenant-1',
          definitionHash: 'definition-hash',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    })).rejects.toMatchObject({
      category: 'ActionError',
      code: 'INTERNAL_ERROR',
      message: 'Large failure',
    });

    const failedUpdate = mocks.updateInvocation.mock.calls.find((call) => call[2]?.status === 'FAILED');
    expect(failedUpdate?.[2]).toMatchObject({
      error_message: 'Large failure',
      error_json: {
        category: 'ActionError',
        code: 'INTERNAL_ERROR',
        message: 'Large failure',
        nodePath: 'root.steps[1]',
        at: '2026-07-16T12:00:00.000Z',
        details: {
          truncated: true,
          max: 32 * 1024,
        },
      },
    });
    expect(JSON.stringify(failedUpdate?.[2].error_json).length).toBeLessThanOrEqual(32 * 1024);
  });

  it('truncates oversized astral-character messages without splitting surrogate pairs', async () => {
    const { executeWorkflowRuntimeV2ActionStep } = await import('../workflow-runtime-v2-activities');

    mocks.actionHandler.mockRejectedValueOnce({
      category: 'ActionError',
      code: 'INTERNAL_ERROR',
      message: '🍄'.repeat(20 * 1024),
      nodePath: 'root.steps[1]',
      at: '2026-07-16T12:00:00.000Z',
    });

    await expect(executeWorkflowRuntimeV2ActionStep({
      runId: 'run-emoji-error',
      stepPath: 'root.steps[1]',
      stepId: 'step-emoji-error',
      tenantId: 'tenant-1',
      step: {
        type: 'action.call',
        config: {
          actionId: 'integration.call',
          version: 1,
        },
      },
      scopes: {
        payload: {},
        workflow: {},
        lexical: [],
        meta: {},
        error: null,
        system: {
          runId: 'run-emoji-error',
          workflowId: 'workflow-1',
          workflowVersion: 3,
          tenantId: 'tenant-1',
          definitionHash: 'definition-hash',
          runtimeSemanticsVersion: '2026-04-08.temporal-native.v1',
        },
      },
    })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    const failedUpdate = mocks.updateInvocation.mock.calls.find((call) => call[2]?.status === 'FAILED');
    const persistedMessage = failedUpdate?.[2].error_json.message as string;
    expect(persistedMessage.endsWith('...[truncated]')).toBe(true);
    // A lone surrogate would serialize as an unpaired \udXXX escape, which
    // Postgres jsonb rejects — the failure record itself would fail to write.
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(loneSurrogate.test(persistedMessage)).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(failedUpdate?.[2].error_json), 'utf8')).toBeLessThanOrEqual(32 * 1024);
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
