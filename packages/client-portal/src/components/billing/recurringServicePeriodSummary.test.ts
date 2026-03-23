import { describe, expect, it } from 'vitest';

import { getRecurringServicePeriodSummary } from './recurringServicePeriodSummary';

describe('recurringServicePeriodSummary', () => {
  it('T197: ordering and aggregation of multi-period recurring charges stay stable for invoice-view summaries', () => {
    const summary = getRecurringServicePeriodSummary(
      {
        service_period_start: null,
        service_period_end: null,
        invoice_charges: [
          {
            item_id: 'charge-1',
            recurring_detail_periods: [
              {
                service_period_start: '2026-02-01',
                service_period_end: '2026-03-01',
              },
              {
                service_period_start: '2026-01-01',
                service_period_end: '2026-02-01',
              },
            ],
          },
          {
            item_id: 'charge-2',
            service_period_start: '2026-03-01',
            service_period_end: '2026-04-01',
          },
          {
            item_id: 'charge-3',
            recurring_detail_periods: [
              {
                service_period_start: '2026-01-01',
                service_period_end: '2026-02-01',
              },
            ],
          },
        ] as any,
      },
      (date) => String(date),
    );

    expect(summary).toBe(
      '2026-01-01 - 2026-02-01; 2026-02-01 - 2026-03-01; 2026-03-01 - 2026-04-01',
    );
  });
});
