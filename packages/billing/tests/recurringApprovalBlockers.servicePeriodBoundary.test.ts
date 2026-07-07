import { describe, expect, it } from 'vitest';

import { getContractServicePeriodEndExclusive } from '../src/actions/recurringApprovalBlockers';

describe('getContractServicePeriodEndExclusive', () => {
  // `service_period_end` is stored as the exclusive end of a half-open period, so
  // it must be used as-is for `end_time < ...`. Adding a day (the previous bug)
  // pulled the whole first day of the NEXT period into the approval scan, which
  // blocked a completed, fully-approved period on the following period's time.
  it('returns the stored (already-exclusive) end unchanged, without adding a day', () => {
    // June is [2026-06-01, 2026-07-01); the approval gate must stop before 2026-07-01,
    // not spill into 2026-07-02 and sweep in July 1 time.
    expect(getContractServicePeriodEndExclusive('2026-07-01')).toBe('2026-07-01');
  });

  it('normalizes a timestamp-form boundary to a date-only exclusive bound', () => {
    expect(getContractServicePeriodEndExclusive('2026-07-01T00:00:00.000Z')).toBe('2026-07-01');
  });

  it('does not roll a month/year boundary forward by a day', () => {
    expect(getContractServicePeriodEndExclusive('2026-01-01')).toBe('2026-01-01');
    expect(getContractServicePeriodEndExclusive('2026-12-01')).toBe('2026-12-01');
  });
});
