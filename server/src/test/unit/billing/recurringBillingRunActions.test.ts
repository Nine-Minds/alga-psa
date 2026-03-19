import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildClientCadenceDueSelectionInput,
  buildContractCadenceDueSelectionInput,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import { buildRecurringDueWorkRow } from '@alga-psa/shared/billingClients/recurringDueWork';

const mocks = vi.hoisted(() => ({
  getCurrentUserAsync: vi.fn(),
  generateInvoiceForSelectionInput: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  getAvailableRecurringDueWork: vi.fn(),
  buildRecurringBillingRunStartedPayload: vi.fn((input) => input),
  buildRecurringBillingRunCompletedPayload: vi.fn((input) => input),
  buildRecurringBillingRunFailedPayload: vi.fn((input) => input),
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', () => ({
  getCurrentUserAsync: mocks.getCurrentUserAsync,
}));

vi.mock('../../../../../packages/billing/src/actions/invoiceGeneration', () => ({
  generateInvoiceForSelectionInput: mocks.generateInvoiceForSelectionInput,
}));

vi.mock('../../../../../packages/billing/src/actions/invoiceGeneration.constants', () => ({
  DUPLICATE_RECURRING_INVOICE_CODE: 'DUPLICATE_RECURRING_INVOICE',
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: mocks.publishWorkflowEvent,
}));

vi.mock('../../../../../packages/billing/src/actions/billingAndTax', () => ({
  getAvailableRecurringDueWork: mocks.getAvailableRecurringDueWork,
}));

vi.mock('@shared/workflow/streams/domainEventBuilders/recurringBillingRunEventBuilders', () => ({
  buildRecurringBillingRunStartedPayload: mocks.buildRecurringBillingRunStartedPayload,
  buildRecurringBillingRunCompletedPayload: mocks.buildRecurringBillingRunCompletedPayload,
  buildRecurringBillingRunFailedPayload: mocks.buildRecurringBillingRunFailedPayload,
}));

const { generateInvoicesAsRecurringBillingRun, selectClientCadenceRecurringRunTargets } = await import(
  '../../../../../packages/billing/src/actions/recurringBillingRunActions'
);

function buildClientCadenceTarget(input: {
  clientId?: string;
  scheduleKey?: string;
  periodKey?: string;
  windowStart?: string;
  windowEnd?: string;
} = {}) {
  const selectorInput = buildClientCadenceDueSelectionInput({
    clientId: input.clientId ?? 'client-1',
    scheduleKey: input.scheduleKey ?? 'schedule-1',
    periodKey: input.periodKey ?? 'period-1',
    windowStart: input.windowStart ?? '2025-02-01',
    windowEnd: input.windowEnd ?? '2025-03-01',
  });

  return {
    selectorInput,
    executionWindow: selectorInput.executionWindow,
  };
}

function buildContractCadenceTarget(input: {
  clientId?: string;
  contractId?: string;
  contractLineId?: string;
  windowStart?: string;
  windowEnd?: string;
} = {}) {
  const selectorInput = buildContractCadenceDueSelectionInput({
    clientId: input.clientId ?? 'client-1',
    contractId: input.contractId ?? 'contract-1',
    contractLineId: input.contractLineId ?? 'line-1',
    windowStart: input.windowStart ?? '2025-02-08',
    windowEnd: input.windowEnd ?? '2025-03-08',
  });

  return {
    selectorInput,
    executionWindow: selectorInput.executionWindow,
  };
}

describe('recurring billing run actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUserAsync.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-1',
    });
    mocks.generateInvoiceForSelectionInput.mockResolvedValue({ invoice_id: 'invoice-1' });
    mocks.publishWorkflowEvent.mockResolvedValue(undefined);
    mocks.getAvailableRecurringDueWork.mockResolvedValue({
      rows: [],
      materializationGaps: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });
  });

  it('T026: recurring billing runs execute client-cadence due work through canonical selector input only', async () => {
    const clientTarget = buildClientCadenceTarget();

    const result = await generateInvoicesAsRecurringBillingRun({
      targets: [clientTarget],
      allowPoOverage: true,
    });

    expect(mocks.generateInvoiceForSelectionInput).toHaveBeenCalledTimes(1);
    expect(mocks.generateInvoiceForSelectionInput).toHaveBeenCalledWith(
      clientTarget.selectorInput,
      { allowPoOverage: true },
    );
    expect(mocks.buildRecurringBillingRunStartedPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionMode: 'due_service_periods',
        windowIdentity: 'client_cadence_window',
        executionWindowKinds: ['client_cadence_window'],
      }),
    );
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
    expect(result.invoicesCreated).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it('T027: recurring billing runs execute contract-cadence due work through canonical selector input only', async () => {
    const contractTarget = buildContractCadenceTarget();

    const result = await generateInvoicesAsRecurringBillingRun({
      targets: [contractTarget],
      allowPoOverage: false,
    });

    expect(mocks.generateInvoiceForSelectionInput).toHaveBeenCalledTimes(1);
    expect(mocks.generateInvoiceForSelectionInput).toHaveBeenCalledWith(
      contractTarget.selectorInput,
      { allowPoOverage: false },
    );
    expect(mocks.buildRecurringBillingRunStartedPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionMode: 'due_service_periods',
        windowIdentity: 'contract_cadence_window',
        executionWindowKinds: ['contract_cadence_window'],
      }),
    );
    expect(mocks.buildRecurringBillingRunCompletedPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionMode: 'due_service_periods',
        windowIdentity: 'contract_cadence_window',
        executionWindowKinds: ['contract_cadence_window'],
      }),
    );
    expect(result.invoicesCreated).toBe(1);
  });

  it('T023: recurring billing run retries keep deterministic selection and retry keys using only canonical execution identity', async () => {
    const clientTarget = buildClientCadenceTarget();
    const contractTarget = buildContractCadenceTarget();

    const firstResult = await generateInvoicesAsRecurringBillingRun({
      targets: [contractTarget, clientTarget],
    });
    const secondResult = await generateInvoicesAsRecurringBillingRun({
      targets: [clientTarget, contractTarget],
    });

    expect(firstResult.runId).not.toBe(secondResult.runId);
    expect(firstResult.selectionKey).toBe(secondResult.selectionKey);
    expect(firstResult.retryKey).toBe(secondResult.retryKey);
    expect(firstResult.selectionKey).toContain(
      'client_cadence_window:client:client-1:schedule-1:period-1:2025-02-01:2025-03-01',
    );
    expect(firstResult.selectionKey).toContain(
      'contract_cadence_window:contract:client-1:contract-1:line-1:2025-02-08:2025-03-08',
    );
    expect(mocks.buildRecurringBillingRunStartedPayload).toHaveBeenLastCalledWith(
      expect.objectContaining({
        windowIdentity: 'mixed_execution_windows',
        executionWindowKinds: ['client_cadence_window', 'contract_cadence_window'],
      }),
    );
  });

  it('skips duplicate recurring invoices without marking the canonical recurring run failed', async () => {
    const duplicateInvoiceError = Object.assign(
      new Error('Invoice already exists for this recurring execution window'),
      { code: 'DUPLICATE_RECURRING_INVOICE' },
    );
    const clientTarget = buildClientCadenceTarget();
    const contractTarget = buildContractCadenceTarget();

    mocks.generateInvoiceForSelectionInput
      .mockRejectedValueOnce(duplicateInvoiceError)
      .mockResolvedValueOnce({ invoice_id: 'invoice-2' });

    const result = await generateInvoicesAsRecurringBillingRun({
      targets: [clientTarget, contractTarget],
      allowPoOverage: true,
    });

    expect(mocks.generateInvoiceForSelectionInput).toHaveBeenNthCalledWith(
      1,
      clientTarget.selectorInput,
      { allowPoOverage: true },
    );
    expect(mocks.generateInvoiceForSelectionInput).toHaveBeenNthCalledWith(
      2,
      contractTarget.selectorInput,
      { allowPoOverage: true },
    );
    expect(result).toMatchObject({
      invoicesCreated: 1,
      failedCount: 0,
      failures: [],
    });
  });

  it('T024: client-cadence recurring run target selection maps canonical due-work rows instead of billing-cycle periods', async () => {
    const firstRow = buildRecurringDueWorkRow({
      selectorInput: buildClientCadenceDueSelectionInput({
        clientId: 'client-1',
        scheduleKey: 'schedule-2',
        periodKey: 'period-2',
        windowStart: '2025-02-10',
        windowEnd: '2025-03-10',
      }),
      cadenceSource: 'client_schedule',
      servicePeriodStart: '2025-02-10',
      servicePeriodEnd: '2025-03-10',
      clientName: 'Acme',
      canGenerate: true,
      asOf: '2025-03-11',
      scheduleKey: 'schedule-2',
      periodKey: 'period-2',
    });
    const secondRow = buildRecurringDueWorkRow({
      selectorInput: buildClientCadenceDueSelectionInput({
        clientId: 'client-1',
        scheduleKey: 'schedule-1',
        periodKey: 'period-1',
        windowStart: '2025-01-10',
        windowEnd: '2025-02-10',
      }),
      cadenceSource: 'client_schedule',
      servicePeriodStart: '2025-01-10',
      servicePeriodEnd: '2025-02-10',
      clientName: 'Acme',
      canGenerate: true,
      asOf: '2025-03-11',
      scheduleKey: 'schedule-1',
      periodKey: 'period-1',
    });
    const skippedRow = buildRecurringDueWorkRow({
      selectorInput: buildClientCadenceDueSelectionInput({
        clientId: 'client-1',
        scheduleKey: 'schedule-skipped',
        periodKey: 'period-skipped',
        windowStart: '2025-03-10',
        windowEnd: '2025-04-10',
      }),
      cadenceSource: 'client_schedule',
      servicePeriodStart: '2025-03-10',
      servicePeriodEnd: '2025-04-10',
      clientName: 'Acme',
      canGenerate: false,
      asOf: '2025-03-11',
      scheduleKey: 'schedule-skipped',
      periodKey: 'period-skipped',
    });

    mocks.getAvailableRecurringDueWork.mockResolvedValue({
      rows: [firstRow, secondRow, skippedRow],
      materializationGaps: [],
      total: 2,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    const result = await selectClientCadenceRecurringRunTargets({
      page: 1,
      pageSize: 10,
      searchTerm: 'Acme',
    });

    expect(mocks.getAvailableRecurringDueWork).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      searchTerm: 'Acme',
    });
    expect(result.targets).toHaveLength(2);
    expect(result.targets.map((target) => target.selectorInput.executionWindow.kind)).toEqual([
      'client_cadence_window',
      'client_cadence_window',
    ]);
    expect(result.targets[0]).toMatchObject({
      clientId: 'client-1',
      clientName: 'Acme',
      periodStart: '2025-01-10',
      periodEnd: '2025-02-10',
      selectorInput: {
        clientId: 'client-1',
        windowStart: '2025-01-10',
        windowEnd: '2025-02-10',
      },
      executionWindow: {
        kind: 'client_cadence_window',
        scheduleKey: 'schedule-1',
        periodKey: 'period-1',
      },
    });
    expect(result.targets[1]?.selectorInput.executionWindow.identityKey).toBe(
      'client_cadence_window:client:client-1:schedule-2:period-2:2025-02-10:2025-03-10',
    );
  });
});
