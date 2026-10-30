import { afterAll, describe, expect, it } from 'vitest';

import { mapHourBlockUsageRow } from '@alga-psa/billing/lib/hourBlockUsageRows';

// Regression guard for the Bucket Hours Utilization report printing hour-block
// dates a day early east of UTC. `expiration_date` is a pg DATE, which
// node-postgres hydrates as a LOCAL-midnight Date: the old
// `new Date(v).toISOString().slice(0, 10)` re-read that instant in UTC and lost
// a day in every zone ahead of UTC. `purchased_at` is a timestamptz instant and
// keeps the report's UTC date-only convention.
//
// TZ is process-global, so it is pinned here and restored afterwards.
const originalTz = process.env.TZ;
process.env.TZ = 'Pacific/Auckland';

function dateColumnValue(isoDateOnly: string): Date {
  const [y, m, d] = isoDateOnly.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

const baseRow = {
  block_id: 'block-1',
  client_id: 'client-1',
  client_name: 'Acme Corp',
  service_name: 'Time Block - 40 Hours',
  contract_name: null,
  status: 'active',
  total_minutes: 2400,
  remaining_minutes: 600,
  hourly_rate: 11000,
  currency_code: 'USD',
  purchased_at: null as string | Date | null,
  expiration_date: null as string | Date | null,
};

describe('mapHourBlockUsageRow date formatting', () => {
  afterAll(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it('renders a DATE expiration as the stored calendar day ahead of UTC', () => {
    expect(new Date().getTimezoneOffset(), 'TZ=Pacific/Auckland did not take effect').toBeLessThan(0);

    const mapped = mapHourBlockUsageRow({ ...baseRow, expiration_date: dateColumnValue('2026-03-01') });

    expect(mapped.expiration_date).toBe('2026-03-01');
  });

  it('passes a YYYY-MM-DD expiration string through unchanged', () => {
    const mapped = mapHourBlockUsageRow({ ...baseRow, expiration_date: '2026-03-01' });

    expect(mapped.expiration_date).toBe('2026-03-01');
  });

  it('keeps a null expiration null', () => {
    expect(mapHourBlockUsageRow({ ...baseRow, expiration_date: null }).expiration_date).toBeNull();
  });

  it('reports a timestamptz purchase on its UTC calendar day', () => {
    const mapped = mapHourBlockUsageRow({
      ...baseRow,
      purchased_at: new Date('2026-03-01T22:30:00.000Z'),
    });

    expect(mapped.purchased_at).toBe('2026-03-01');
  });

  it('still derives the burn-down numbers from the minute columns', () => {
    const mapped = mapHourBlockUsageRow(baseRow);

    expect(mapped.total_hours).toBe(40);
    expect(mapped.used_hours).toBe(30);
    expect(mapped.remaining_hours).toBe(10);
    expect(mapped.utilization_percentage).toBe(75);
  });
});
