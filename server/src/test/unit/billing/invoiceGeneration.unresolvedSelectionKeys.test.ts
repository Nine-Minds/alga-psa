import { describe, expect, it, vi } from 'vitest';
import { calculateBillingForSelectionInputs } from '../../../../../packages/billing/src/actions/invoiceGeneration';

describe('invoice generation unresolved selection keys', () => {
  it('T008: unresolved schedule keys drive non-contract selection without relying on legacy key syntax', async () => {
    const billingEngine: any = {
      selectDueRecurringServicePeriodsForBillingWindow: vi.fn(async () => ({
        'line-1': { duePosition: 'arrears' },
      })),
      calculateBillingForExecutionWindow: vi.fn(async () => ({
        charges: [],
        totalAmount: 0,
        discounts: [],
        adjustments: [],
        finalAmount: 0,
        currency_code: 'USD',
      })),
    };

    await calculateBillingForSelectionInputs({
      billingEngine,
      selectorInputs: [
        {
          clientId: 'client-1',
          windowStart: '2026-03-01',
          windowEnd: '2026-04-01',
          executionWindow: {
            kind: 'client_cadence_window',
            scheduleKey: 'schedule:tenant-1:unresolved:usage:usage-1',
            periodKey: 'period:2026-03-01:2026-04-01:unresolved:usage:usage-1',
            identityKey: 'exec-unresolved-1',
          },
        } as any,
      ],
    });

    expect(billingEngine.calculateBillingForExecutionWindow).toHaveBeenCalledWith(
      'client-1',
      '2026-03-01',
      '2026-04-01',
      expect.objectContaining({
        nonContractSelection: {
          include: true,
          timeEntryIds: [],
          usageRecordIds: ['usage-1'],
        },
      }),
    );
  });

  it('T008: legacy non_contract keys remain parseable for backward compatibility', async () => {
    const billingEngine: any = {
      selectDueRecurringServicePeriodsForBillingWindow: vi.fn(async () => ({
        'line-1': { duePosition: 'arrears' },
      })),
      calculateBillingForExecutionWindow: vi.fn(async () => ({
        charges: [],
        totalAmount: 0,
        discounts: [],
        adjustments: [],
        finalAmount: 0,
        currency_code: 'USD',
      })),
    };

    await calculateBillingForSelectionInputs({
      billingEngine,
      selectorInputs: [
        {
          clientId: 'client-1',
          windowStart: '2026-03-01',
          windowEnd: '2026-04-01',
          executionWindow: {
            kind: 'client_cadence_window',
            scheduleKey: 'schedule:tenant-1:non_contract:time:te-1',
            periodKey: 'period:2026-03-01:2026-04-01:time:te-1',
            identityKey: 'exec-legacy-1',
          },
        } as any,
      ],
    });

    expect(billingEngine.calculateBillingForExecutionWindow).toHaveBeenCalledWith(
      'client-1',
      '2026-03-01',
      '2026-04-01',
      expect.objectContaining({
        nonContractSelection: {
          include: true,
          timeEntryIds: ['te-1'],
          usageRecordIds: [],
        },
      }),
    );
  });
});
