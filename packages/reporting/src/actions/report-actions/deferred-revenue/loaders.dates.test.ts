import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPricingScheduleRates, resolvePricingScheduleRate } from './loaders';

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({ whereIn: () => ({ select }) }) }),
}));

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('deferred revenue schedule dates', () => {
  it.each([
    ['Europe/Berlin', -120], ['Pacific/Auckland', -720], ['America/Los_Angeles', 420],
  ])('preserves stored dates and schedule selection in %s', async (zone, offset) => {
    process.env.TZ = String(zone);
    expect(new Date(2026, 5, 1).getTimezoneOffset()).toBe(offset);
    select.mockResolvedValue([{
      contract_id: 'contract-1', contract_line_id: 'line-1', custom_rate: 90000,
      effective_date: new Date(2026, 5, 1), end_date: new Date(2026, 6, 1),
    }, {
      contract_id: 'contract-1', contract_line_id: 'line-2', custom_rate: 10000,
      effective_date: '2026-06-01', end_date: null,
    }]);
    const schedules = await loadPricingScheduleRates({} as any, 'tenant-1', ['contract-1']);
    expect(schedules[0]).toMatchObject({ effectiveDate: '2026-06-01', endDate: '2026-07-01' });
    expect(schedules[1]).toMatchObject({ effectiveDate: '2026-06-01', endDate: null });
    expect(resolvePricingScheduleRate('2026-05-01', '2026-05-31', 'contract-1', schedules, 'line-1')).toBeNull();
    expect(resolvePricingScheduleRate('2026-06-01', '2026-06-30', 'contract-1', schedules, 'line-1')).toBe(90000);
    expect(resolvePricingScheduleRate('2026-07-01', '2026-07-31', 'contract-1', schedules, 'line-1')).toBeNull();
  });
});
