import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('@alga-psa/billing/services/clientContractServiceConfigurationService', () => ({
  ClientContractServiceConfigurationService: {},
}));
vi.mock('@alga-psa/shared/billingClients/contractBillingTrace', () => ({ loadContractBillingTrace: vi.fn() }));
import { loadPricingSchedules } from '../../lib/billing/simulator/snapshotContractToScenario';

const originalTZ = process.env.TZ;
afterEach(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

describe('simulator pricing schedule snapshot calendar dates', () => {
  it.each(['Europe/Berlin', 'Pacific/Auckland', 'America/Los_Angeles'])('preserves pg DATE boundaries in %s', async (tz) => {
    process.env.TZ = tz;
    const query = {
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue([
        { effective_date: new Date(2026, 5, 1), end_date: new Date(2026, 6, 1), custom_rate: '90000', contract_line_id: 'line-1' },
        { effective_date: '2026-06-01', end_date: null, custom_rate: null },
      ]),
    };
    const db = { table: vi.fn(() => query) };
    expect(await loadPricingSchedules(db as any, 'contract-1')).toEqual([
      { effective_date: '2026-06-01T00:00:00Z', end_date: '2026-07-01T00:00:00Z', custom_rate: 90000, contract_line_key: 'line-1' },
      { effective_date: '2026-06-01T00:00:00Z', end_date: null, custom_rate: null, contract_line_key: null },
    ]);
    expect(query.select).toHaveBeenCalledWith('effective_date', 'end_date', 'custom_rate', 'contract_line_id');
    await loadPricingSchedules(db as any, 'template-1', true);
    expect(db.table).toHaveBeenLastCalledWith('contract_template_pricing_schedules');
    expect(query.select).toHaveBeenLastCalledWith('effective_date', 'end_date', 'custom_rate');
  });
});
