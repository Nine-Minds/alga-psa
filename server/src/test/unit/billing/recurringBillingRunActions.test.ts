import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildClientCadenceDueSelectionInput,
  buildContractCadenceDueSelectionInput,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import { buildRecurringDueWorkRow } from '@alga-psa/shared/billingClients/recurringDueWork';
import { mapClientCadenceInvoiceCandidatesToRecurringRunTargets } from '../../../../../packages/billing/src/actions/recurringBillingRunActions.shared';

const mocks = vi.hoisted(() => ({
  getCurrentUserAsync: vi.fn(),
  generateInvoiceForSelectionInput: vi.fn(),
  generateInvoiceForSelectionInputs: vi.fn(),
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
  generateInvoiceForSelectionInputs: mocks.generateInvoiceForSelectionInputs,
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

const {
  generateInvoicesAsRecurringBillingRun,
  generateGroupedInvoicesAsRecurringBillingRun,
  selectClientCadenceRecurringRunTargets,
} = await import(
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
    mocks.generateInvoiceForSelectionInputs.mockResolvedValue({ invoice_id: 'invoice-1' });
    mocks.publishWorkflowEvent.mockResolvedValue(undefined);
    mocks.getAvailableRecurringDueWork.mockResolvedValue({
      invoiceCandidates: [],
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

  it('T018: grouped recurring run generation creates one invoice for a combinable parent selection group', async () => {
    const firstTarget = buildContractCadenceTarget({ contractLineId: 'line-1' });
    const secondTarget = buildContractCadenceTarget({ contractLineId: 'line-2' });

    const result = await generateGroupedInvoicesAsRecurringBillingRun({
      groupedTargets: [
        {
          groupKey: 'parent-selection:invoice-candidate:client-1:2025-02-08:2025-03-08',
          selectorInputs: [firstTarget.selectorInput, secondTarget.selectorInput],
        },
      ],
    });

    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenCalledTimes(1);
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenCalledWith(
      [firstTarget.selectorInput, secondTarget.selectorInput],
      { allowPoOverage: undefined },
    );
    expect(mocks.generateInvoiceForSelectionInput).not.toHaveBeenCalled();
    expect(result.invoicesCreated).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it('T019: grouped recurring run generation fans out non-combinable child selections into multiple invoices', async () => {
    const firstTarget = buildContractCadenceTarget({ contractLineId: 'line-1' });
    const secondTarget = buildContractCadenceTarget({ contractLineId: 'line-2' });

    const result = await generateGroupedInvoicesAsRecurringBillingRun({
      groupedTargets: [
        {
          groupKey: 'child-selection:line-1',
          selectorInputs: [firstTarget.selectorInput],
        },
        {
          groupKey: 'child-selection:line-2',
          selectorInputs: [secondTarget.selectorInput],
        },
      ],
    });

    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenCalledTimes(2);
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenNthCalledWith(
      1,
      [firstTarget.selectorInput],
      { allowPoOverage: undefined },
    );
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenNthCalledWith(
      2,
      [secondTarget.selectorInput],
      { allowPoOverage: undefined },
    );
    expect(result.invoicesCreated).toBe(2);
    expect(result.failedCount).toBe(0);
  });

  it('T021: duplicate grouped/member selections are skipped without blocking unrelated sibling groups', async () => {
    const duplicateInvoiceError = Object.assign(
      new Error('Invoice already exists for this recurring execution window'),
      { code: 'DUPLICATE_RECURRING_INVOICE' },
    );
    const firstTarget = buildContractCadenceTarget({ contractLineId: 'line-1' });
    const secondTarget = buildContractCadenceTarget({ contractLineId: 'line-2' });

    mocks.generateInvoiceForSelectionInputs
      .mockRejectedValueOnce(duplicateInvoiceError)
      .mockResolvedValueOnce({ invoice_id: 'invoice-2' });

    const result = await generateGroupedInvoicesAsRecurringBillingRun({
      groupedTargets: [
        {
          groupKey: 'child-selection:line-1',
          selectorInputs: [firstTarget.selectorInput],
        },
        {
          groupKey: 'child-selection:line-2',
          selectorInputs: [secondTarget.selectorInput],
        },
      ],
    });

    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      invoicesCreated: 1,
      failedCount: 0,
      failures: [],
    });
  });

  it('T032: mixed grouped targets combine compatible parents and fan out incompatible child targets without cross-contamination', async () => {
    const parentFirst = buildContractCadenceTarget({ contractLineId: 'line-parent-1' });
    const parentSecond = buildContractCadenceTarget({ contractLineId: 'line-parent-2' });
    const childA = buildContractCadenceTarget({ contractLineId: 'line-child-a' });
    const childB = buildContractCadenceTarget({ contractLineId: 'line-child-b' });

    const result = await generateGroupedInvoicesAsRecurringBillingRun({
      groupedTargets: [
        {
          groupKey: 'parent-selection:compatible-parent-window',
          selectorInputs: [parentFirst.selectorInput, parentSecond.selectorInput],
        },
        {
          groupKey: 'child-selection:incompatible-a',
          selectorInputs: [childA.selectorInput],
        },
        {
          groupKey: 'child-selection:incompatible-b',
          selectorInputs: [childB.selectorInput],
        },
      ],
    });

    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenCalledTimes(3);
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenNthCalledWith(
      1,
      [parentFirst.selectorInput, parentSecond.selectorInput],
      { allowPoOverage: undefined },
    );
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenNthCalledWith(
      2,
      [childA.selectorInput],
      { allowPoOverage: undefined },
    );
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenNthCalledWith(
      3,
      [childB.selectorInput],
      { allowPoOverage: undefined },
    );
    expect(result).toMatchObject({
      invoicesCreated: 3,
      failedCount: 0,
      failures: [],
    });
  });

  it('T033: grouped duplicate protection skips prior combined selections without blocking unrelated sibling execution', async () => {
    const duplicateInvoiceError = Object.assign(
      new Error('Invoice already exists for this recurring execution window'),
      { code: 'DUPLICATE_RECURRING_INVOICE' },
    );
    const combinedA = buildContractCadenceTarget({ contractLineId: 'line-combined-a' });
    const combinedB = buildContractCadenceTarget({ contractLineId: 'line-combined-b' });
    const siblingTarget = buildContractCadenceTarget({ contractLineId: 'line-sibling' });

    mocks.generateInvoiceForSelectionInputs
      .mockRejectedValueOnce(duplicateInvoiceError)
      .mockResolvedValueOnce({ invoice_id: 'invoice-sibling' });

    const result = await generateGroupedInvoicesAsRecurringBillingRun({
      groupedTargets: [
        {
          groupKey: 'parent-selection:already-invoiced-combined',
          selectorInputs: [combinedA.selectorInput, combinedB.selectorInput],
        },
        {
          groupKey: 'child-selection:fresh-sibling',
          selectorInputs: [siblingTarget.selectorInput],
        },
      ],
    });

    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenCalledTimes(2);
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenNthCalledWith(
      1,
      [combinedA.selectorInput, combinedB.selectorInput],
      { allowPoOverage: undefined },
    );
    expect(mocks.generateInvoiceForSelectionInputs).toHaveBeenNthCalledWith(
      2,
      [siblingTarget.selectorInput],
      { allowPoOverage: undefined },
    );
    expect(result).toMatchObject({
      invoicesCreated: 1,
      failedCount: 0,
      failures: [],
    });
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
      invoiceCandidates: [
        {
          candidateKey: 'candidate-1',
          clientId: 'client-1',
          clientName: 'Acme',
          executionWindow: firstRow.executionWindow,
          selectorInput: firstRow.selectorInput,
          windowStart: '2025-02-10',
          windowEnd: '2025-03-10',
          windowLabel: '2025-02-10 to 2025-03-10',
          servicePeriodStart: '2025-02-10',
          servicePeriodEnd: '2025-03-10',
          servicePeriodLabel: '2025-02-10 to 2025-03-10',
          isEarly: false,
          cadenceOwners: ['client'],
          cadenceSources: ['client_schedule'],
          contractId: null,
          contractName: null,
          splitReasons: [],
          memberCount: 1,
          canGenerate: true,
          blockedReason: null,
          members: [firstRow],
        },
        {
          candidateKey: 'candidate-2',
          clientId: 'client-1',
          clientName: 'Acme',
          executionWindow: secondRow.executionWindow,
          selectorInput: secondRow.selectorInput,
          windowStart: '2025-01-10',
          windowEnd: '2025-02-10',
          windowLabel: '2025-01-10 to 2025-02-10',
          servicePeriodStart: '2025-01-10',
          servicePeriodEnd: '2025-02-10',
          servicePeriodLabel: '2025-01-10 to 2025-02-10',
          isEarly: false,
          cadenceOwners: ['client'],
          cadenceSources: ['client_schedule'],
          contractId: null,
          contractName: null,
          splitReasons: [],
          memberCount: 1,
          canGenerate: true,
          blockedReason: null,
          members: [secondRow],
        },
        {
          candidateKey: 'candidate-3',
          clientId: 'client-1',
          clientName: 'Acme',
          executionWindow: skippedRow.executionWindow,
          selectorInput: skippedRow.selectorInput,
          windowStart: '2025-03-10',
          windowEnd: '2025-04-10',
          windowLabel: '2025-03-10 to 2025-04-10',
          servicePeriodStart: '2025-03-10',
          servicePeriodEnd: '2025-04-10',
          servicePeriodLabel: '2025-03-10 to 2025-04-10',
          isEarly: true,
          cadenceOwners: ['client'],
          cadenceSources: ['client_schedule'],
          contractId: null,
          contractName: null,
          splitReasons: [],
          memberCount: 1,
          canGenerate: false,
          blockedReason: 'Blocked',
          members: [skippedRow],
        },
      ],
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

  it('T102: recurring run target mapper yields exactly one target per client-cadence candidate', () => {
    const firstMember = buildRecurringDueWorkRow({
      selectorInput: buildClientCadenceDueSelectionInput({
        clientId: 'client-1',
        scheduleKey: 'schedule-grouped',
        periodKey: 'period-grouped-a',
        windowStart: '2025-02-01',
        windowEnd: '2025-03-01',
      }),
      cadenceSource: 'client_schedule',
      servicePeriodStart: '2025-02-01',
      servicePeriodEnd: '2025-03-01',
      clientName: 'Acme',
      canGenerate: true,
      asOf: '2025-03-10',
      scheduleKey: 'schedule-grouped',
      periodKey: 'period-grouped-a',
    });
    const groupedSelectorInput = buildClientCadenceDueSelectionInput({
      clientId: 'client-1',
      scheduleKey: 'schedule-grouped',
      periodKey: 'period-grouped',
      windowStart: '2025-02-01',
      windowEnd: '2025-03-01',
    });

    const targets = mapClientCadenceInvoiceCandidatesToRecurringRunTargets([
      {
        candidateKey: 'candidate-grouped-client',
        clientId: 'client-1',
        clientName: 'Acme',
        executionWindow: groupedSelectorInput.executionWindow,
        selectorInput: groupedSelectorInput,
        windowStart: '2025-02-01',
        windowEnd: '2025-03-01',
        windowLabel: '2025-02-01 to 2025-03-01',
        servicePeriodStart: '2025-02-01',
        servicePeriodEnd: '2025-03-01',
        servicePeriodLabel: '2025-02-01 to 2025-03-01',
        isEarly: false,
        cadenceOwners: ['client'],
        cadenceSources: ['client_schedule'],
        contractId: null,
        contractName: null,
        splitReasons: [],
        memberCount: 2,
        canGenerate: true,
        blockedReason: null,
        members: [
          firstMember,
          {
            ...firstMember,
            executionIdentityKey: `${firstMember.executionIdentityKey}:member-2`,
          },
        ],
      },
    ]);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      clientId: 'client-1',
      clientName: 'Acme',
      selectorInput: groupedSelectorInput,
      executionWindow: groupedSelectorInput.executionWindow,
    });
  });

  it('T103: selectClientCadenceRecurringRunTargets keeps candidate pagination totals independent from filtered target count', async () => {
    const clientRow = buildRecurringDueWorkRow({
      selectorInput: buildClientCadenceDueSelectionInput({
        clientId: 'client-1',
        scheduleKey: 'schedule-eligible',
        periodKey: 'period-eligible',
        windowStart: '2025-04-01',
        windowEnd: '2025-05-01',
      }),
      cadenceSource: 'client_schedule',
      servicePeriodStart: '2025-04-01',
      servicePeriodEnd: '2025-05-01',
      clientName: 'Acme',
      canGenerate: true,
      asOf: '2025-05-02',
      scheduleKey: 'schedule-eligible',
      periodKey: 'period-eligible',
    });
    const contractRow = buildRecurringDueWorkRow({
      selectorInput: buildContractCadenceDueSelectionInput({
        clientId: 'client-1',
        contractId: 'contract-1',
        contractLineId: 'line-1',
        windowStart: '2025-04-08',
        windowEnd: '2025-05-08',
      }),
      cadenceSource: 'contract_anniversary',
      servicePeriodStart: '2025-03-08',
      servicePeriodEnd: '2025-04-08',
      clientName: 'Acme',
      canGenerate: true,
      asOf: '2025-05-02',
      scheduleKey: 'schedule-contract',
      periodKey: 'period-contract',
      contractId: 'contract-1',
      contractName: 'Annual Support',
      contractLineId: 'line-1',
      contractLineName: 'Managed Services',
    });

    mocks.getAvailableRecurringDueWork.mockResolvedValue({
      invoiceCandidates: [
        {
          candidateKey: 'candidate-client-eligible',
          clientId: 'client-1',
          clientName: 'Acme',
          executionWindow: clientRow.executionWindow,
          selectorInput: clientRow.selectorInput,
          windowStart: '2025-04-01',
          windowEnd: '2025-05-01',
          windowLabel: '2025-04-01 to 2025-05-01',
          servicePeriodStart: '2025-04-01',
          servicePeriodEnd: '2025-05-01',
          servicePeriodLabel: '2025-04-01 to 2025-05-01',
          isEarly: false,
          cadenceOwners: ['client'],
          cadenceSources: ['client_schedule'],
          contractId: null,
          contractName: null,
          splitReasons: [],
          memberCount: 1,
          canGenerate: true,
          blockedReason: null,
          members: [clientRow],
        },
        {
          candidateKey: 'candidate-contract-nonclient',
          clientId: 'client-1',
          clientName: 'Acme',
          executionWindow: contractRow.executionWindow,
          selectorInput: contractRow.selectorInput,
          windowStart: '2025-04-08',
          windowEnd: '2025-05-08',
          windowLabel: '2025-04-08 to 2025-05-08',
          servicePeriodStart: '2025-03-08',
          servicePeriodEnd: '2025-04-08',
          servicePeriodLabel: '2025-03-08 to 2025-04-08',
          isEarly: false,
          cadenceOwners: ['contract'],
          cadenceSources: ['contract_anniversary'],
          contractId: 'contract-1',
          contractName: 'Annual Support',
          splitReasons: [],
          memberCount: 1,
          canGenerate: true,
          blockedReason: null,
          members: [contractRow],
        },
      ],
      materializationGaps: [],
      total: 7,
      page: 2,
      pageSize: 2,
      totalPages: 4,
    });

    const result = await selectClientCadenceRecurringRunTargets({
      page: 2,
      pageSize: 2,
      searchTerm: 'Acme',
    });

    expect(result.targets).toHaveLength(1);
    expect(result.total).toBe(7);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(2);
    expect(result.totalPages).toBe(4);
  });
});
