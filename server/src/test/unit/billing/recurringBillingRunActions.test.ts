import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildClientBillingCycleExecutionWindow,
  buildContractCadenceExecutionWindow,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';

const mocks = vi.hoisted(() => ({
  getCurrentUserAsync: vi.fn(),
  generateInvoice: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  getAvailableBillingPeriods: vi.fn(),
  buildRecurringBillingRunStartedPayload: vi.fn((input) => input),
  buildRecurringBillingRunCompletedPayload: vi.fn((input) => input),
  buildRecurringBillingRunFailedPayload: vi.fn((input) => input),
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', () => ({
  getCurrentUserAsync: mocks.getCurrentUserAsync,
}));

vi.mock('../../../../../packages/billing/src/actions/invoiceGeneration', () => ({
  generateInvoice: mocks.generateInvoice,
  DUPLICATE_RECURRING_INVOICE_CODE: 'DUPLICATE_RECURRING_INVOICE',
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: mocks.publishWorkflowEvent,
}));

vi.mock('../../../../../packages/billing/src/actions/billingAndTax', () => ({
  getAvailableBillingPeriods: mocks.getAvailableBillingPeriods,
}));

vi.mock('@shared/workflow/streams/domainEventBuilders/recurringBillingRunEventBuilders', () => ({
  buildRecurringBillingRunStartedPayload: mocks.buildRecurringBillingRunStartedPayload,
  buildRecurringBillingRunCompletedPayload: mocks.buildRecurringBillingRunCompletedPayload,
  buildRecurringBillingRunFailedPayload: mocks.buildRecurringBillingRunFailedPayload,
}));

const { generateInvoicesAsRecurringBillingRun, selectClientCadenceRecurringRunTargets } = await import(
  '../../../../../packages/billing/src/actions/recurringBillingRunActions'
);

describe('recurring billing run actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUserAsync.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-1',
    });
    mocks.generateInvoice.mockResolvedValue({ invoice_id: 'invoice-1' });
    mocks.publishWorkflowEvent.mockResolvedValue(undefined);
    mocks.getAvailableBillingPeriods.mockResolvedValue({
      periods: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });
  });

  it('T081: automatic recurring billing runs delegate each selected billing cycle through generateInvoice after the service-period-first cutover', async () => {
    mocks.generateInvoice
      .mockResolvedValueOnce({ invoice_id: 'invoice-1' })
      .mockResolvedValueOnce({ invoice_id: 'invoice-2' });

    const result = await generateInvoicesAsRecurringBillingRun({
      billingCycleIds: ['cycle-1', 'cycle-2'],
      allowPoOverage: true,
    });

    expect(mocks.generateInvoice).toHaveBeenCalledTimes(2);
    expect(mocks.generateInvoice).toHaveBeenNthCalledWith(1, 'cycle-1', {
      allowPoOverage: true,
    });
    expect(mocks.generateInvoice).toHaveBeenNthCalledWith(2, 'cycle-2', {
      allowPoOverage: true,
    });
    expect(mocks.publishWorkflowEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: 'RECURRING_BILLING_RUN_STARTED',
        idempotencyKey: `recurring-billing-run:${result.runId}:started`,
      }),
    );
    expect(mocks.publishWorkflowEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: 'RECURRING_BILLING_RUN_COMPLETED',
        idempotencyKey: `recurring-billing-run:${result.runId}:completed`,
      }),
    );
    expect(result.invoicesCreated).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it('T079: recurring billing workflow events keep run identity, actor metadata, and completion counts stable on the service-period-first path', async () => {
    mocks.generateInvoice
      .mockResolvedValueOnce({ invoice_id: 'invoice-1' })
      .mockResolvedValueOnce(null);

    const result = await generateInvoicesAsRecurringBillingRun({
      billingCycleIds: ['cycle-1', 'cycle-2'],
      allowPoOverage: false,
    });

    expect(mocks.buildRecurringBillingRunStartedPayload).toHaveBeenCalledWith({
      runId: result.runId,
      startedAt: expect.any(String),
      initiatedByUserId: 'user-1',
      selectionKey: expect.stringContaining('recurring-run-selection:'),
      retryKey: expect.stringContaining('recurring-run-retry:'),
      selectionMode: 'due_service_periods',
      windowIdentity: 'billing_cycle_window',
      executionWindowKinds: ['billing_cycle_window'],
    });
    expect(mocks.buildRecurringBillingRunCompletedPayload).toHaveBeenCalledWith({
      runId: result.runId,
      completedAt: expect.any(String),
      selectionKey: result.selectionKey,
      retryKey: result.retryKey,
      invoicesCreated: 1,
      failedCount: 0,
      selectionMode: 'due_service_periods',
      windowIdentity: 'billing_cycle_window',
      executionWindowKinds: ['billing_cycle_window'],
    });
    expect(mocks.publishWorkflowEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: 'RECURRING_BILLING_RUN_STARTED',
        ctx: expect.objectContaining({
          tenantId: 'tenant-1',
          actor: { actorType: 'USER', actorUserId: 'user-1' },
          correlationId: result.runId,
        }),
      }),
    );
    expect(mocks.publishWorkflowEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: 'RECURRING_BILLING_RUN_COMPLETED',
        ctx: expect.objectContaining({
          tenantId: 'tenant-1',
          actor: { actorType: 'USER', actorUserId: 'user-1' },
          correlationId: result.runId,
        }),
      }),
    );
  });

  it('T082: automatic recurring billing reruns skip already-invoiced cycles without double-billing or marking the run failed', async () => {
    const duplicateInvoiceError = Object.assign(
      new Error('Invoice already exists for this billing cycle'),
      {
        code: 'DUPLICATE_RECURRING_INVOICE',
        billingCycleId: 'cycle-1',
        invoiceId: 'invoice-1',
      },
    );

    mocks.generateInvoice
      .mockRejectedValueOnce(duplicateInvoiceError)
      .mockResolvedValueOnce({ invoice_id: 'invoice-2' });

    const result = await generateInvoicesAsRecurringBillingRun({
      billingCycleIds: ['cycle-1', 'cycle-2'],
      allowPoOverage: true,
    });

    expect(mocks.generateInvoice).toHaveBeenNthCalledWith(1, 'cycle-1', {
      allowPoOverage: true,
    });
    expect(mocks.generateInvoice).toHaveBeenNthCalledWith(2, 'cycle-2', {
      allowPoOverage: true,
    });
    expect(result).toMatchObject({
      invoicesCreated: 1,
      failedCount: 0,
      failures: [],
    });
    expect(mocks.buildRecurringBillingRunCompletedPayload).toHaveBeenCalledWith({
      runId: result.runId,
      completedAt: expect.any(String),
      selectionKey: result.selectionKey,
      retryKey: result.retryKey,
      invoicesCreated: 1,
      failedCount: 0,
      selectionMode: 'due_service_periods',
      windowIdentity: 'billing_cycle_window',
      executionWindowKinds: ['billing_cycle_window'],
    });
  });

  it('T184: recurring run retries keep a deterministic selection and retry key even when execution-window order changes', async () => {
    const firstResult = await generateInvoicesAsRecurringBillingRun({
      targets: [
        {
          billingCycleId: 'cycle-2',
          executionWindow: buildContractCadenceExecutionWindow({
            clientId: 'client-1',
            contractId: 'contract-1',
            contractLineId: 'line-1',
            windowStart: '2025-02-08',
            windowEnd: '2025-03-08',
          }),
        },
        {
          billingCycleId: 'cycle-1',
          executionWindow: buildClientBillingCycleExecutionWindow({
            billingCycleId: 'cycle-1',
            clientId: 'client-1',
            windowStart: '2025-02-01',
            windowEnd: '2025-03-01',
          }),
        },
      ],
    });
    const secondResult = await generateInvoicesAsRecurringBillingRun({
      targets: [
        {
          billingCycleId: 'cycle-1',
          executionWindow: buildClientBillingCycleExecutionWindow({
            billingCycleId: 'cycle-1',
            clientId: 'client-1',
            windowStart: '2025-02-01',
            windowEnd: '2025-03-01',
          }),
        },
        {
          billingCycleId: 'cycle-2',
          executionWindow: buildContractCadenceExecutionWindow({
            clientId: 'client-1',
            contractId: 'contract-1',
            contractLineId: 'line-1',
            windowStart: '2025-02-08',
            windowEnd: '2025-03-08',
          }),
        },
      ],
    });

    expect(firstResult.runId).not.toBe(secondResult.runId);
    expect(firstResult.selectionKey).toBe(secondResult.selectionKey);
    expect(firstResult.retryKey).toBe(secondResult.retryKey);
    expect(firstResult.selectionKey).toContain('billing_cycle_window:client:client-1:cycle-1:2025-02-01:2025-03-01');
    expect(firstResult.selectionKey).toContain('contract_cadence_window:contract:client-1:contract-1:line-1:2025-02-08:2025-03-08');
  });

  it('T186: client-cadence due-work selection stays deterministic from persisted billing-period windows even when current anchors differ later', async () => {
    mocks.getAvailableBillingPeriods.mockResolvedValue({
      periods: [
        {
          client_id: 'client-1',
          client_name: 'Acme',
          billing_cycle_id: 'cycle-2',
          billing_cycle: 'monthly',
          period_start_date: '2025-02-10',
          period_end_date: '2025-03-10',
          effective_date: '2025-02-10',
          tenant: 'tenant-1',
          can_generate: true,
          is_early: false,
        },
        {
          client_id: 'client-1',
          client_name: 'Acme',
          billing_cycle_id: 'cycle-1',
          billing_cycle: 'monthly',
          period_start_date: '2025-01-10',
          period_end_date: '2025-02-10',
          effective_date: '2025-01-10',
          tenant: 'tenant-1',
          can_generate: true,
          is_early: false,
        },
        {
          client_id: 'client-1',
          client_name: 'Acme',
          billing_cycle_id: 'cycle-skipped',
          billing_cycle: 'monthly',
          period_start_date: '2025-03-10',
          period_end_date: '2025-04-10',
          effective_date: '2025-03-10',
          tenant: 'tenant-1',
          can_generate: false,
          is_early: true,
        },
      ],
      total: 3,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    const result = await selectClientCadenceRecurringRunTargets({
      page: 1,
      pageSize: 10,
      searchTerm: 'Acme',
    });

    expect(mocks.getAvailableBillingPeriods).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      searchTerm: 'Acme',
    });
    expect(result.targets.map((target) => target.billingCycleId)).toEqual(['cycle-1', 'cycle-2']);
    expect(result.targets[0]).toMatchObject({
      clientId: 'client-1',
      clientName: 'Acme',
      periodStart: '2025-01-10',
      periodEnd: '2025-02-10',
      selectorInput: {
        clientId: 'client-1',
        billingCycleId: 'cycle-1',
        windowStart: '2025-01-10',
        windowEnd: '2025-02-10',
      },
      executionWindow: {
        kind: 'billing_cycle_window',
        billingCycleId: 'cycle-1',
        windowStart: '2025-01-10',
        windowEnd: '2025-02-10',
      },
    });
    expect(result.targets[1]?.selectorInput.executionWindow.identityKey).toBe(
      'billing_cycle_window:client:client-1:cycle-2:2025-02-10:2025-03-10',
    );
  });
});
