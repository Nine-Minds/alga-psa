import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUserAsync: vi.fn(),
  generateInvoice: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  buildRecurringBillingRunStartedPayload: vi.fn((input) => input),
  buildRecurringBillingRunCompletedPayload: vi.fn((input) => input),
  buildRecurringBillingRunFailedPayload: vi.fn((input) => input),
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', () => ({
  getCurrentUserAsync: mocks.getCurrentUserAsync,
}));

vi.mock('../../../../../packages/billing/src/actions/invoiceGeneration', () => ({
  generateInvoice: mocks.generateInvoice,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: mocks.publishWorkflowEvent,
}));

vi.mock('@shared/workflow/streams/domainEventBuilders/recurringBillingRunEventBuilders', () => ({
  buildRecurringBillingRunStartedPayload: mocks.buildRecurringBillingRunStartedPayload,
  buildRecurringBillingRunCompletedPayload: mocks.buildRecurringBillingRunCompletedPayload,
  buildRecurringBillingRunFailedPayload: mocks.buildRecurringBillingRunFailedPayload,
}));

const { generateInvoicesAsRecurringBillingRun } = await import(
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
});
