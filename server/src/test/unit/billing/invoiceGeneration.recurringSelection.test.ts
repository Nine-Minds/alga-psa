import { describe, expect, it, vi } from 'vitest';

import {
  calculateBillingForInvoiceWindow,
  calculateBillingForSelectionInput,
} from '@alga-psa/billing/actions/invoiceGeneration';
import {
  buildClientCadenceDueSelectionInput,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';

describe('invoice generation recurring selection', () => {
  it('T071 and T292: invoice generation selects due persisted service periods before billing calculation and passes them as authoritative runtime selections', async () => {
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
      calculateBillingForExecutionWindow: vi.fn().mockResolvedValue(billingResult),
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
    ).toHaveBeenCalledWith('client-1', '2025-02-01', '2025-03-01');
    expect(billingEngine.calculateBillingForExecutionWindow).toHaveBeenCalledWith(
      'client-1',
      '2025-02-01',
      '2025-03-01',
      {
        recurringTimingSelections,
        recurringTimingSelectionSource: 'persisted',
      },
    );
    expect(billingEngine.calculateBilling).not.toHaveBeenCalled();
    expect(
      billingEngine.selectDueRecurringServicePeriodsForBillingWindow.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      billingEngine.calculateBillingForExecutionWindow.mock.invocationCallOrder[0],
    );
    expect(result).toBe(billingResult);
  });

  it('T183: selector-input recurring billing can choose due recurring service periods without requiring a raw billingCycleId', async () => {
    const recurringTimingSelections = {
      'assignment-1': {
        duePosition: 'advance',
        servicePeriodStart: '2025-02-08',
        servicePeriodEnd: '2025-03-08',
        servicePeriodStartExclusive: '2025-02-08',
        servicePeriodEndExclusive: '2025-03-09',
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
    const selectorInput = buildClientCadenceDueSelectionInput({
      clientId: 'client-1',
      scheduleKey: 'schedule:tenant-1:client_contract_line:assignment-1:client:advance',
      periodKey: 'period:2025-02-08:2025-03-08',
      windowStart: '2025-02-08',
      windowEnd: '2025-03-08',
    });
    const billingEngine = {
      selectDueRecurringServicePeriodsForBillingWindow: vi
        .fn()
        .mockResolvedValue(recurringTimingSelections),
      calculateBilling: vi.fn().mockResolvedValue(billingResult),
      calculateBillingForExecutionWindow: vi.fn().mockResolvedValue(billingResult),
    } as any;

    const result = await calculateBillingForSelectionInput({
      billingEngine,
      selectorInput,
    });

    expect(
      billingEngine.selectDueRecurringServicePeriodsForBillingWindow,
    ).toHaveBeenCalledWith(
      'client-1',
      '2025-02-08',
      '2025-03-08',
    );
    expect(billingEngine.calculateBillingForExecutionWindow).toHaveBeenCalledWith(
      'client-1',
      '2025-02-08',
      '2025-03-08',
      {
        recurringTimingSelections,
        recurringTimingSelectionSource: 'persisted',
      },
    );
    expect(billingEngine.calculateBilling).not.toHaveBeenCalled();
    expect(result).toBe(billingResult);
  });

  it('T089: recurring invoice selection stays stable when non-recurring charges share the invoice result', async () => {
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
      charges: [
        {
          type: 'fixed',
          client_contract_line_id: 'contract-line-1',
          serviceId: 'service-1',
          total: 100,
          servicePeriodStart: '2025-01-01',
          servicePeriodEnd: '2025-01-31',
          billingTiming: 'arrears',
        },
        {
          type: 'time',
          client_contract_line_id: 'hourly-line-1',
          serviceId: 'hourly-service',
          total: 250,
          servicePeriodStart: '2025-02-01',
          servicePeriodEnd: '2025-02-28',
          billingTiming: 'arrears',
        },
        {
          type: 'usage',
          client_contract_line_id: 'usage-line-1',
          serviceId: 'usage-service',
          total: 75,
          servicePeriodStart: '2025-02-01',
          servicePeriodEnd: '2025-02-28',
          billingTiming: 'arrears',
        },
      ],
      discounts: [],
      adjustments: [],
      totalAmount: 425,
      finalAmount: 425,
      currency_code: 'USD',
    };

    const billingEngine = {
      selectDueRecurringServicePeriodsForBillingWindow: vi
        .fn()
        .mockResolvedValue(recurringTimingSelections),
      calculateBilling: vi.fn().mockResolvedValue(billingResult),
      calculateBillingForExecutionWindow: vi.fn().mockResolvedValue(billingResult),
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
    ).toHaveBeenCalledWith('client-1', '2025-02-01', '2025-03-01');
    expect(billingEngine.calculateBillingForExecutionWindow).toHaveBeenCalledWith(
      'client-1',
      '2025-02-01',
      '2025-03-01',
      {
        recurringTimingSelections,
        recurringTimingSelectionSource: 'persisted',
      },
    );
    expect(result.charges.map((charge: any) => charge.type)).toEqual([
      'fixed',
      'time',
      'usage',
    ]);
    expect(result).toBe(billingResult);
  });
});
