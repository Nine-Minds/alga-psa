import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('@alga-psa/billing/services/clientContractServiceConfigurationService', () => ({
  ClientContractServiceConfigurationService: class {
    async getConfigurationsForClientContractLine() { return []; }
  },
}));
vi.mock('@alga-psa/shared/billingClients/contractBillingTrace', () => ({ loadContractBillingTrace: vi.fn() }));
import { tenantDb } from '@alga-psa/db';
import { loadPricingSchedules, snapshotContractToScenario } from '../../lib/billing/simulator/snapshotContractToScenario';

const originalTZ = process.env.TZ;
afterEach(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

describe('simulator pricing schedule snapshot calendar dates', () => {
  it('preserves live line activity and historical schedule bindings in the full snapshot', async () => {
    const lineRows = [true, true, false].map((is_active, index) => ({
      contract_line_id: `line-${index}`, contract_line_name: `Line ${index}`,
      contract_line_type: 'Fixed', billing_frequency: 'monthly',
      billing_timing: 'advance', cadence_owner: 'client', custom_rate: 50000,
      is_active,
    }));
    const rowsByTable: Record<string, Record<string, unknown>[]> = {
      contracts: [{ contract_id: 'contract-1', contract_name: 'Contract', billing_frequency: 'monthly', currency_code: 'USD' }],
      contract_lines: lineRows,
      contract_pricing_schedules: [
        { effective_date: '2026-06-01', end_date: null, custom_rate: 90000, contract_line_id: null },
        { effective_date: '2026-06-01', end_date: null, custom_rate: 70000, contract_line_id: 'line-2' },
      ],
    };
    const lineWhere = vi.fn().mockReturnThis();
    const db = {
      tenantJoin: vi.fn(),
      table: vi.fn((table: string) => ({
        where: table === 'contract_lines' ? lineWhere : vi.fn().mockReturnThis(),
        whereIn: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        first: vi.fn(async () => rowsByTable[table]?.[0]),
        // Project selected columns so omitting is_active from SQL loses it here too.
        select: vi.fn(async (...columns: string[]) => (rowsByTable[table] ?? []).map((row) =>
          Object.fromEntries(columns.map((column) => [column, row[column]])),
        )),
      })),
    };
    vi.mocked(tenantDb).mockReturnValue(db as any);

    const scenario = await snapshotContractToScenario({} as any, 'tenant-1', {
      contractId: 'contract-1', clientContractId: null, forceProfile: true,
    });

    expect(scenario.lines.map((line) => ({ key: line.key, is_active: line.is_active }))).toEqual([
      { key: 'line-0', is_active: true },
      { key: 'line-1', is_active: true },
      { key: 'line-2', is_active: false },
    ]);
    expect(lineWhere).toHaveBeenCalledExactlyOnceWith({ contract_id: 'contract-1' });
    expect(scenario.pricing_schedules.map((schedule) => schedule.contract_line_key)).toEqual([null, 'line-2']);
  });

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
