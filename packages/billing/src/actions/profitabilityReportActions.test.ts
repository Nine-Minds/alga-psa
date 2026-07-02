import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

const rawMock = vi.hoisted(() => vi.fn());

function makeTable(tableName: string) {
  return {
    select: vi.fn().mockReturnThis(),
    count: vi.fn().mockReturnThis(),
    first: vi.fn(async () => {
      if (tableName === 'default_billing_settings') {
        return { default_currency_code: 'USD' };
      }
      if (tableName === 'user_cost_rates') {
        return { count: '1' };
      }
      return null;
    }),
  };
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: { raw: rawMock } })),
  tenantDb: vi.fn((_knex: unknown, _tenant: string) => ({
    table: (tableName: string) => makeTable(tableName),
  })),
}));

import { hasPermission } from '@alga-psa/auth/rbac';
import {
  getAgreementProfitability,
  getClientProfitability,
  getProfitabilitySummary,
} from './profitabilityReportActions';

const revenueRows = [
  {
    item_id: 'item-1',
    client_id: 'client-1',
    client_name: 'Acme',
    client_contract_id: 'cc-1',
    contract_id: 'contract-1',
    contract_name: 'Managed Services',
    contract_line_id: 'line-1',
    contract_line_name: 'Support',
    amount_cents: 10000,
    unconverted: false,
  },
];

const laborRows = [
  {
    entry_id: 'entry-1',
    work_item_type: 'ticket',
    work_item_id: 'ticket-1',
    client_id: 'client-1',
    client_name: 'Acme',
    ticket_number: 'T-100',
    ticket_title: 'Fix issue',
    contract_line_id: 'line-1',
    contract_line_name: 'Support',
    client_contract_id: 'cc-1',
    contract_id: 'contract-1',
    contract_name: 'Managed Services',
    actual_minutes: 60,
    billable_minutes: 30,
    cost_rate: 5000,
    approval_status: 'APPROVED',
  },
];

const materialRows = [
  {
    material_type: 'ticket',
    material_id: 'mat-1',
    ticket_id: 'ticket-1',
    project_id: null,
    client_id: 'client-1',
    client_name: 'Acme',
    quantity: 1,
    rate: 3000,
    material_currency_code: 'USD',
    service_cost: 1000,
    billed_invoice_id: 'invoice-1',
    invoice_currency_code: 'USD',
    exchange_rate_basis_points: null,
    revenue_cents: 3000,
    cost_cents: 1000,
    currency_mismatch: false,
    uncosted: false,
  },
];

function seedRawMocks(options?: {
  revenue?: Array<Record<string, unknown>>;
  labor?: Array<Record<string, unknown>>;
  materials?: Array<Record<string, unknown>>;
}) {
  rawMock.mockImplementation(async (sql: string) => {
    if (sql.includes('WITH charge_details')) {
      return { rows: options?.revenue ?? revenueRows };
    }
    if (sql.includes('FROM time_entries te')) {
      return { rows: options?.labor ?? laborRows };
    }
    if (sql.includes('WITH material_rows')) {
      return { rows: options?.materials ?? materialRows };
    }
    throw new Error('Unexpected SQL');
  });
}

describe('profitability report actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasPermission).mockResolvedValue(true);
    seedRawMocks();
  });

  it('requires billing.read', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);

    await expect((getProfitabilitySummary as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { startDate: '2026-01-01', endDate: '2026-01-31' },
    )).rejects.toThrow('Permission denied: billing read required');
  });

  it('returns summary totals with actual-hour EHR and known revenue/cost fixture', async () => {
    const summary = await (getProfitabilitySummary as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { startDate: '2026-01-01', endDate: '2026-01-31' },
    );

    expect(summary).toMatchObject({
      revenue: 13000,
      laborCost: 5000,
      materialCost: 1000,
      margin: 7000,
      marginPct: 53.85,
      totalMinutes: 60,
      effectiveHourlyRate: 13000,
      costRatesConfigured: true,
    });
  });

  it('reduces revenue for negative invoice charge facts', async () => {
    seedRawMocks({
      revenue: [
        ...revenueRows,
        {
          ...revenueRows[0],
          item_id: 'discount-1',
          amount_cents: -1000,
        },
      ],
      labor: [],
      materials: [],
    });

    const summary = await (getProfitabilitySummary as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { startDate: '2026-01-01', endDate: '2026-01-31' },
    );

    expect(summary.revenue).toBe(9000);
    expect(summary.margin).toBe(9000);
  });


  it('groups client profitability by client and reports no-client time separately', async () => {
    seedRawMocks({
      labor: [
        ...laborRows,
        {
          ...laborRows[0],
          entry_id: 'entry-2',
          work_item_type: 'ad_hoc',
          work_item_id: null,
          client_id: null,
          client_name: null,
          contract_line_id: null,
          client_contract_id: null,
          actual_minutes: 30,
          cost_rate: 4000,
        },
      ],
    });

    const rows = await (getClientProfitability as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { startDate: '2026-01-01', endDate: '2026-01-31' },
    );

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ clientId: 'client-1', clientName: 'Acme', revenue: 13000 }),
      expect.objectContaining({ clientId: null, clientName: 'No client', laborCost: 2000, totalMinutes: 30 }),
    ]));
  });

  it('reconciles agreement rows with ad-hoc material revenue and unattributed material cost', async () => {
    const rows = await (getAgreementProfitability as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { startDate: '2026-01-01', endDate: '2026-01-31', clientId: 'client-1' },
    );

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rowType: 'agreement',
        clientContractId: 'cc-1',
        revenue: 10000,
        laborCost: 5000,
      }),
      expect.objectContaining({
        rowType: 'ad_hoc',
        contractName: 'Ad-hoc / manual',
        revenue: 3000,
      }),
      expect.objectContaining({
        rowType: 'unattributed',
        contractName: 'Unattributed',
        materialCost: 1000,
      }),
    ]));

    const totalRevenue = rows.reduce((sum: number, row: any) => sum + row.revenue, 0);
    const totalCost = rows.reduce((sum: number, row: any) => sum + row.laborCost + row.materialCost, 0);
    expect(totalRevenue).toBe(13000);
    expect(totalCost).toBe(6000);
  });

  it('costs actual minutes with per-entry rounding and counts non-billable unapproved zero-duration and uncosted time', async () => {
    seedRawMocks({
      revenue: [],
      materials: [],
      labor: [
        {
          ...laborRows[0],
          entry_id: 'odd-minutes',
          actual_minutes: 17,
          billable_minutes: 0,
          cost_rate: 1000,
          approval_status: 'DRAFT',
        },
        {
          ...laborRows[0],
          entry_id: 'zero-duration',
          actual_minutes: 0,
          billable_minutes: 0,
          cost_rate: 5000,
          approval_status: 'APPROVED',
        },
        {
          ...laborRows[0],
          entry_id: 'uncosted',
          contract_line_id: null,
          client_contract_id: null,
          actual_minutes: 30,
          billable_minutes: 0,
          cost_rate: null,
          approval_status: 'SUBMITTED',
        },
      ],
    });

    const summary = await (getProfitabilitySummary as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { startDate: '2026-01-01', endDate: '2026-01-31' },
    );

    expect(summary).toMatchObject({
      revenue: 0,
      laborCost: 283,
      totalMinutes: 47,
      uncostedMinutes: 30,
      unattributedMinutes: 30,
      unapprovedMinutes: 47,
      zeroDurationEntryCount: 1,
      effectiveHourlyRate: 0,
    });
  });

  it('keeps EHR null-safe when revenue exists without actual hours', async () => {
    seedRawMocks({ labor: [], materials: [] });

    const summary = await (getProfitabilitySummary as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      { startDate: '2026-01-01', endDate: '2026-01-31' },
    );

    expect(summary.revenue).toBe(10000);
    expect(summary.totalMinutes).toBe(0);
    expect(summary.effectiveHourlyRate).toBeNull();
  });
});
