import { describe, expect, it, vi } from 'vitest';

import { calculateBillingForInvoiceWindow } from '@alga-psa/billing/actions/invoiceGeneration';

describe('invoice generation recurring selection', () => {
  it('T071: invoice generation selects due recurring service periods before billing calculation', async () => {
    const recurringTimingSelections = {
      'contract-line-1': {
        duePosition: 'arrears',
        servicePeriodStart: '2025-01-01',
        servicePeriodEnd: '2025-01-31',
        servicePeriodStartExclusive: '2025-01-01',
        servicePeriodEndExclusive: '2025-02-01',
        coverageRatio: 1,
      },
    };
    const billingResult = {
      charges: [],
      discounts: [],
      adjustments: [],
      totalAmount: 0,
      finalAmount: 0,
      currency_code: 'USD',
    };

    const billingEngine = {
      selectDueRecurringServicePeriodsForBillingWindow: vi
        .fn()
        .mockResolvedValue(recurringTimingSelections),
      calculateBilling: vi.fn().mockResolvedValue(billingResult),
    } as any;

    const result = await calculateBillingForInvoiceWindow({
      billingEngine,
      clientId: 'client-1',
      cycleStart: '2025-02-01',
      cycleEnd: '2025-03-01',
      billingCycleId: 'cycle-1',
    });

    expect(
      billingEngine.selectDueRecurringServicePeriodsForBillingWindow,
    ).toHaveBeenCalledWith('client-1', '2025-02-01', '2025-03-01', 'cycle-1');
    expect(billingEngine.calculateBilling).toHaveBeenCalledWith(
      'client-1',
      '2025-02-01',
      '2025-03-01',
      'cycle-1',
      { recurringTimingSelections },
    );
    expect(
      billingEngine.selectDueRecurringServicePeriodsForBillingWindow.mock
        .invocationCallOrder[0],
    ).toBeLessThan(billingEngine.calculateBilling.mock.invocationCallOrder[0]);
    expect(result).toBe(billingResult);
  });
});
