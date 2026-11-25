import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFixedLineRateInputs } from './loadFixedLineRateInputs';
import { selectActivePricingSchedule } from './resolveFixedLineRate';

const { table } = vi.hoisted(() => ({ table: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({ table, tenantJoin: vi.fn() }) }));

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('fixed line preview schedule dates', () => {
  it.each([
    ['Europe/Berlin', -120], ['Pacific/Auckland', -720], ['America/Los_Angeles', 420],
  ])('preserves pg DATE boundaries for rate-review and rollout previews in %s', async (zone, offset) => {
    process.env.TZ = String(zone);
    expect(new Date(2026, 5, 1).getTimezoneOffset()).toBe(offset);
    const rows: Record<string, unknown[]> = {
      contract_lines: [{ contract_line_id: 'line-1', contract_id: 'contract-1', custom_rate: 50000 }],
      contracts: [{ contract_id: 'contract-1', currency_code: 'USD' }],
      contract_pricing_schedules: [{
        schedule_id: 'schedule-1', contract_id: 'contract-1', contract_line_id: 'line-1',
        effective_date: new Date(2026, 5, 1), end_date: new Date(2026, 6, 1), custom_rate: 90000,
      }, {
        schedule_id: 'other-line', contract_id: 'contract-1', contract_line_id: 'line-2',
        effective_date: '2026-06-01', end_date: null, custom_rate: 10000,
      }],
    };
    table.mockImplementation((name: string) => {
      const query: any = {
        whereIn: vi.fn().mockReturnThis(), whereNotNull: vi.fn().mockReturnThis(),
        whereNot: vi.fn().mockReturnThis(), modify: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(), first: vi.fn(async () => undefined),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows[name] ?? []).then(resolve),
      };
      return query;
    });

    const bundle = (await loadFixedLineRateInputs({} as any, 'tenant-1', ['line-1'])).get('line-1')!;
    expect(bundle.schedules[0]).toMatchObject({ effective_date: '2026-06-01', end_date: '2026-07-01' });
    expect(bundle.schedules[1]).toMatchObject({ effective_date: '2026-06-01', end_date: null });
    expect(selectActivePricingSchedule(bundle.schedules, 'line-1', { start: '2026-05-01', end: '2026-06-01' })).toBeNull();
    expect(selectActivePricingSchedule(bundle.schedules, 'line-1', { start: '2026-06-01', end: '2026-07-01' })?.custom_rate).toBe(90000);
    expect(selectActivePricingSchedule(bundle.schedules, 'line-1', { start: '2026-07-01', end: '2026-08-01' })).toBeNull();
  });
});
