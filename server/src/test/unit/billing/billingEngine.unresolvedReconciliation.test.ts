import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingEngine } from '@alga-psa/billing/services';

function buildSelectBuilder(rows: Array<Record<string, any>>) {
  const builder: any = {};
  let resolvedRows = rows;

  const passthrough = () => builder;
  builder.join = vi.fn(passthrough);
  builder.leftJoin = vi.fn(passthrough);
  builder.where = vi.fn((condition: any) => {
    if (typeof condition === 'function') {
      condition.call(builder, builder);
    }
    return builder;
  });
  builder.andWhere = vi.fn(passthrough);
  builder.orWhere = vi.fn(passthrough);
  builder.whereNull = vi.fn(passthrough);
  builder.whereNotNull = vi.fn(passthrough);
  builder.whereIn = vi.fn(passthrough);
  builder.orderBy = vi.fn(passthrough);
  builder.select = vi.fn(() => {
    resolvedRows = rows;
    return builder;
  });
  builder.then = vi.fn((onFulfilled?: any, onRejected?: any) => Promise.resolve(resolvedRows).then(onFulfilled, onRejected));
  builder.first = vi.fn(async () => rows[0] ?? null);

  return builder;
}

function buildUpdateBuilder() {
  const builder: any = {};
  const passthrough = () => builder;
  builder.where = vi.fn((condition: any) => {
    if (typeof condition === 'function') {
      condition.call(builder, builder);
    }
    return builder;
  });
  builder.whereNull = vi.fn(passthrough);
  builder.update = vi.fn(async () => 1);
  return builder;
}

describe('BillingEngine unresolved reconciliation', () => {
  let billingEngine: BillingEngine;

  beforeEach(() => {
    billingEngine = new BillingEngine();
    (billingEngine as any).tenant = 'tenant-1';
    vi.spyOn(billingEngine as any, 'getClientDefaultTaxRegionCode').mockResolvedValue(null);
    vi.spyOn(billingEngine as any, 'getTaxInfoFromService').mockResolvedValue({
      taxRegion: null,
      isTaxable: false,
    });
  });

  it('T005: deterministic unresolved time entry is persisted and excluded from unresolved output', async () => {
    const clientsBuilder = buildSelectBuilder([{ client_id: 'client-1', tenant: 'tenant-1', is_tax_exempt: false, default_currency_code: 'USD' }]);
    const timeSelectBuilder = buildSelectBuilder([
      {
        entry_id: 'te-deterministic',
        service_id: 'svc-1',
        user_id: 'user-1',
        start_time: new Date('2026-03-01T09:00:00.000Z'),
        end_time: new Date('2026-03-01T10:00:00.000Z'),
        default_rate: 100,
        custom_rate: null,
        tax_rate_id: null,
        service_name: 'Service 1',
      },
    ]);
    const timeUpdateBuilder = buildUpdateBuilder();
    const usageSelectBuilder = buildSelectBuilder([]);

    let timeEntriesCalls = 0;
    (billingEngine as any).knex = vi.fn((table: string) => {
      if (table === 'clients') return clientsBuilder;
      if (table === 'time_entries') {
        timeEntriesCalls += 1;
        return timeEntriesCalls === 1 ? timeSelectBuilder : timeUpdateBuilder;
      }
      if (table === 'usage_tracking') return usageSelectBuilder;
      throw new Error(`Unexpected table ${table}`);
    });
    (billingEngine as any).knex.fn = { now: vi.fn(() => 'NOW') };

    vi.spyOn(billingEngine as any, 'getEligibleContractLineIdsForServiceAtDate').mockResolvedValue(['line-1']);

    const unresolved = await (billingEngine as any).calculateUnresolvedNonContractCharges(
      'client-1',
      { startDate: '2026-03-01', endDate: '2026-04-01' },
    );

    expect(unresolved).toEqual([]);
    expect(timeUpdateBuilder.whereNull).toHaveBeenCalledWith('contract_line_id');
    expect(timeUpdateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ contract_line_id: 'line-1' }),
    );
  });

  it('T006: deterministic unresolved usage record is persisted and excluded from unresolved output', async () => {
    const clientsBuilder = buildSelectBuilder([{ client_id: 'client-1', tenant: 'tenant-1', is_tax_exempt: false, default_currency_code: 'USD' }]);
    const timeSelectBuilder = buildSelectBuilder([]);
    const usageSelectBuilder = buildSelectBuilder([
      {
        usage_id: 'usage-deterministic',
        service_id: 'svc-1',
        quantity: 3,
        usage_date: '2026-03-05',
        default_rate: 100,
        custom_rate: null,
        tax_rate_id: null,
        service_name: 'Service 1',
      },
    ]);
    const usageUpdateBuilder = buildUpdateBuilder();

    let usageCalls = 0;
    (billingEngine as any).knex = vi.fn((table: string) => {
      if (table === 'clients') return clientsBuilder;
      if (table === 'time_entries') return timeSelectBuilder;
      if (table === 'usage_tracking') {
        usageCalls += 1;
        return usageCalls === 1 ? usageSelectBuilder : usageUpdateBuilder;
      }
      throw new Error(`Unexpected table ${table}`);
    });
    (billingEngine as any).knex.fn = { now: vi.fn(() => 'NOW') };

    vi.spyOn(billingEngine as any, 'getEligibleContractLineIdsForServiceAtDate').mockResolvedValue(['line-2']);

    const unresolved = await (billingEngine as any).calculateUnresolvedNonContractCharges(
      'client-1',
      { startDate: '2026-03-01', endDate: '2026-04-01' },
    );

    expect(unresolved).toEqual([]);
    expect(usageUpdateBuilder.whereNull).toHaveBeenCalledWith('contract_line_id');
    expect(usageUpdateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ contract_line_id: 'line-2' }),
    );
  });

  it('T007: ambiguous/no-match rows remain unresolved while deterministic rows are reconciled', async () => {
    const clientsBuilder = buildSelectBuilder([{ client_id: 'client-1', tenant: 'tenant-1', is_tax_exempt: false, default_currency_code: 'USD' }]);
    const timeSelectBuilder = buildSelectBuilder([
      {
        entry_id: 'te-ambiguous',
        service_id: 'svc-ambiguous',
        user_id: 'user-1',
        start_time: new Date('2026-03-03T09:00:00.000Z'),
        end_time: new Date('2026-03-03T10:00:00.000Z'),
        default_rate: 100,
        custom_rate: null,
        tax_rate_id: null,
        service_name: 'Service Ambiguous',
      },
      {
        entry_id: 'te-deterministic',
        service_id: 'svc-single',
        user_id: 'user-1',
        start_time: new Date('2026-03-04T09:00:00.000Z'),
        end_time: new Date('2026-03-04T10:00:00.000Z'),
        default_rate: 100,
        custom_rate: null,
        tax_rate_id: null,
        service_name: 'Service Single',
      },
    ]);
    const usageSelectBuilder = buildSelectBuilder([
      {
        usage_id: 'usage-no-match',
        service_id: 'svc-none',
        quantity: 2,
        usage_date: '2026-03-07',
        default_rate: 100,
        custom_rate: null,
        tax_rate_id: null,
        service_name: 'Service None',
      },
      {
        usage_id: 'usage-deterministic',
        service_id: 'svc-single-usage',
        quantity: 4,
        usage_date: '2026-03-08',
        default_rate: 100,
        custom_rate: null,
        tax_rate_id: null,
        service_name: 'Service Single Usage',
      },
    ]);
    const timeUpdateBuilder = buildUpdateBuilder();
    const usageUpdateBuilder = buildUpdateBuilder();

    let timeCalls = 0;
    let usageCalls = 0;
    (billingEngine as any).knex = vi.fn((table: string) => {
      if (table === 'clients') return clientsBuilder;
      if (table === 'time_entries') {
        timeCalls += 1;
        return timeCalls === 1 ? timeSelectBuilder : timeUpdateBuilder;
      }
      if (table === 'usage_tracking') {
        usageCalls += 1;
        return usageCalls === 1 ? usageSelectBuilder : usageUpdateBuilder;
      }
      throw new Error(`Unexpected table ${table}`);
    });
    (billingEngine as any).knex.fn = { now: vi.fn(() => 'NOW') };

    const eligibleSpy = vi.spyOn(billingEngine as any, 'getEligibleContractLineIdsForServiceAtDate');
    eligibleSpy.mockImplementation(async ({ serviceId }: { serviceId: string }) => {
      if (serviceId === 'svc-ambiguous') return ['line-a', 'line-b'];
      if (serviceId === 'svc-single') return ['line-single'];
      if (serviceId === 'svc-none') return [];
      if (serviceId === 'svc-single-usage') return ['line-single-usage'];
      return [];
    });

    const unresolved = await (billingEngine as any).calculateUnresolvedNonContractCharges(
      'client-1',
      { startDate: '2026-03-01', endDate: '2026-04-01' },
    );

    expect(unresolved).toHaveLength(2);
    expect(unresolved.map((charge: any) => charge.entryId ?? charge.usageId).sort()).toEqual([
      'te-ambiguous',
      'usage-no-match',
    ]);
    expect(timeUpdateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ contract_line_id: 'line-single' }),
    );
    expect(usageUpdateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ contract_line_id: 'line-single-usage' }),
    );
  });
});
