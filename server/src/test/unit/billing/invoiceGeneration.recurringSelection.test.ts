import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculateBillingForInvoiceWindow } from '@alga-psa/billing/actions/invoiceGeneration';

const originalComparisonMode = process.env.RECURRING_BILLING_COMPARISON_MODE;

afterEach(() => {
  if (originalComparisonMode === undefined) {
    delete process.env.RECURRING_BILLING_COMPARISON_MODE;
  } else {
    process.env.RECURRING_BILLING_COMPARISON_MODE = originalComparisonMode;
  }
  vi.restoreAllMocks();
});

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

  it('T154: comparison mode can run legacy-style billing alongside canonical selection without mutating the live billing result', async () => {
    process.env.RECURRING_BILLING_COMPARISON_MODE = 'legacy-vs-canonical';

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
    const canonicalBillingResult = {
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
      ],
      discounts: [],
      adjustments: [],
      totalAmount: 100,
      finalAmount: 100,
      currency_code: 'USD',
    };
    const legacyBillingResult = {
      charges: [
        {
          type: 'fixed',
          client_contract_line_id: 'contract-line-1',
          serviceId: 'service-1',
          total: 125,
          servicePeriodStart: '2025-01-01',
          servicePeriodEnd: '2025-01-31',
          billingTiming: 'arrears',
        },
      ],
      discounts: [],
      adjustments: [],
      totalAmount: 125,
      finalAmount: 125,
      currency_code: 'USD',
    };

    const billingEngine = {
      selectDueRecurringServicePeriodsForBillingWindow: vi
        .fn()
        .mockResolvedValue(recurringTimingSelections),
      calculateBilling: vi
        .fn()
        .mockResolvedValueOnce(canonicalBillingResult)
        .mockResolvedValueOnce(legacyBillingResult),
    } as any;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await calculateBillingForInvoiceWindow({
      billingEngine,
      clientId: 'client-1',
      cycleStart: '2025-02-01',
      cycleEnd: '2025-03-01',
      billingCycleId: 'cycle-1',
    });

    expect(billingEngine.calculateBilling).toHaveBeenNthCalledWith(
      1,
      'client-1',
      '2025-02-01',
      '2025-03-01',
      'cycle-1',
      { recurringTimingSelections },
    );
    expect(billingEngine.calculateBilling).toHaveBeenNthCalledWith(
      2,
      'client-1',
      '2025-02-01',
      '2025-03-01',
      'cycle-1',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[recurring-billing-comparison] Drift detected between canonical and legacy-style invoice-window billing results.',
      expect.objectContaining({
        billingCycleId: 'cycle-1',
      }),
    );
    expect(result).toBe(canonicalBillingResult);
  });

  it('T157: comparison mode ignores out-of-scope time, usage, and material drift so the first cutover only compares recurring-backed charges', async () => {
    process.env.RECURRING_BILLING_COMPARISON_MODE = 'legacy-vs-canonical';

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
    const recurringCharge = {
      type: 'fixed',
      client_contract_line_id: 'contract-line-1',
      serviceId: 'service-1',
      total: 100,
      servicePeriodStart: '2025-01-01',
      servicePeriodEnd: '2025-01-31',
      billingTiming: 'arrears',
    };
    const canonicalBillingResult = {
      charges: [
        recurringCharge,
        {
          type: 'time',
          client_contract_line_id: 'hourly-line-1',
          serviceId: 'hourly-service',
          total: 400,
          servicePeriodStart: '2025-02-01',
          servicePeriodEnd: '2025-02-28',
          billingTiming: 'arrears',
        },
        {
          type: 'usage',
          client_contract_line_id: 'usage-line-1',
          serviceId: 'usage-service',
          total: 250,
          servicePeriodStart: '2025-02-01',
          servicePeriodEnd: '2025-02-28',
          billingTiming: 'arrears',
        },
        {
          type: 'product',
          serviceId: 'material-service',
          total: 175,
          servicePeriodStart: null,
          servicePeriodEnd: null,
          billingTiming: null,
        },
      ],
      discounts: [],
      adjustments: [],
      totalAmount: 925,
      finalAmount: 925,
      currency_code: 'USD',
    };
    const legacyBillingResult = {
      charges: [
        recurringCharge,
        {
          type: 'time',
          client_contract_line_id: 'hourly-line-1',
          serviceId: 'hourly-service',
          total: 650,
          servicePeriodStart: '2025-02-01',
          servicePeriodEnd: '2025-02-28',
          billingTiming: 'arrears',
        },
        {
          type: 'usage',
          client_contract_line_id: 'usage-line-1',
          serviceId: 'usage-service',
          total: 100,
          servicePeriodStart: '2025-02-01',
          servicePeriodEnd: '2025-02-28',
          billingTiming: 'arrears',
        },
        {
          type: 'product',
          serviceId: 'material-service',
          total: 999,
          servicePeriodStart: null,
          servicePeriodEnd: null,
          billingTiming: null,
        },
      ],
      discounts: [],
      adjustments: [],
      totalAmount: 1749,
      finalAmount: 1749,
      currency_code: 'USD',
    };

    const billingEngine = {
      selectDueRecurringServicePeriodsForBillingWindow: vi
        .fn()
        .mockResolvedValue(recurringTimingSelections),
      calculateBilling: vi
        .fn()
        .mockResolvedValueOnce(canonicalBillingResult)
        .mockResolvedValueOnce(legacyBillingResult),
    } as any;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await calculateBillingForInvoiceWindow({
      billingEngine,
      clientId: 'client-1',
      cycleStart: '2025-02-01',
      cycleEnd: '2025-03-01',
      billingCycleId: 'cycle-1',
    });

    expect(billingEngine.calculateBilling).toHaveBeenCalledTimes(2);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(result).toBe(canonicalBillingResult);
  });
});
