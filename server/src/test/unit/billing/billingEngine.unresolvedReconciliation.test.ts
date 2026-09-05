import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingEngine } from '@alga-psa/billing/services';

// Step 5 of the charge-attribution chain reads the client's default billing
// profile from the database. These suites mock knex, so the read is stubbed —
// attribution is covered by the resolver unit tests and the profile integration
// suites, which run against a real schema.
vi.mock('@alga-psa/shared/billingClients/billingProfiles', async (importOriginal) =>
  (await import('../../../../test-utils/billingProfileUnitStub')).billingProfilesModuleStub(importOriginal as any));
vi.mock('@alga-psa/shared/billingClients/billingProfileSettings', async (importOriginal) =>
  (await import('../../../../test-utils/billingProfileUnitStub')).billingProfileSettingsModuleStub(importOriginal as any));


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
  builder.update = vi.fn(async () => 1);

  return builder;
}

const eligibleLine = (clientContractLineId: string) => ({
  client_contract_line_id: clientContractLineId,
  billing_profile_id: null,
  contract_billing_profile_id: null,
});

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

  it('T005: deterministic time-entry attribution is proposed in memory and excluded from unresolved output', async () => {
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
    const usageSelectBuilder = buildSelectBuilder([]);

    (billingEngine as any).knex = vi.fn((table: string) => {
      if (table === 'clients') return clientsBuilder;
      if (table === 'time_entries') return timeSelectBuilder;
      if (table === 'usage_tracking') return usageSelectBuilder;
      throw new Error(`Unexpected table ${table}`);
    });
    (billingEngine as any).knex.fn = { now: vi.fn(() => 'NOW') };
    // The unresolved-charges select carries raw COALESCEs (the work-item
    // billing profile from tickets/projects, and hour_block_time_allocations
    // minutes), so the stub needs raw() as well as fn.
    (billingEngine as any).knex.raw = vi.fn((sql: string) => ({ sql }));

    // Candidates rather than bare ids: the reconcile path narrows a
    // multi-candidate field by the work item's billing profile (F135), so the
    // assignments travel with each line.
    vi.spyOn(billingEngine as any, 'getEligibleContractLinesForServiceAtDate')
      .mockResolvedValue([eligibleLine('line-1')]);

    const unresolved = await (billingEngine as any).calculateUnresolvedNonContractCharges(
      'client-1',
      { startDate: '2026-03-01', endDate: '2026-04-01' },
    );

    expect(unresolved).toEqual([]);
    expect(timeSelectBuilder.update).not.toHaveBeenCalled();
  });

  it('T006: deterministic usage attribution is proposed in memory and excluded from unresolved output', async () => {
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
    (billingEngine as any).knex = vi.fn((table: string) => {
      if (table === 'clients') return clientsBuilder;
      if (table === 'time_entries') return timeSelectBuilder;
      if (table === 'usage_tracking') return usageSelectBuilder;
      throw new Error(`Unexpected table ${table}`);
    });
    (billingEngine as any).knex.fn = { now: vi.fn(() => 'NOW') };
    // The unresolved-charges select carries raw COALESCEs (the work-item
    // billing profile from tickets/projects, and hour_block_time_allocations
    // minutes), so the stub needs raw() as well as fn.
    (billingEngine as any).knex.raw = vi.fn((sql: string) => ({ sql }));

    vi.spyOn(billingEngine as any, 'getEligibleContractLinesForServiceAtDate')
      .mockResolvedValue([eligibleLine('line-2')]);

    const unresolved = await (billingEngine as any).calculateUnresolvedNonContractCharges(
      'client-1',
      { startDate: '2026-03-01', endDate: '2026-04-01' },
    );

    expect(unresolved).toEqual([]);
    expect(usageSelectBuilder.update).not.toHaveBeenCalled();
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
    (billingEngine as any).knex = vi.fn((table: string) => {
      if (table === 'clients') return clientsBuilder;
      if (table === 'time_entries') return timeSelectBuilder;
      if (table === 'usage_tracking') return usageSelectBuilder;
      throw new Error(`Unexpected table ${table}`);
    });
    (billingEngine as any).knex.fn = { now: vi.fn(() => 'NOW') };
    // The unresolved-charges select carries raw COALESCEs (the work-item
    // billing profile from tickets/projects, and hour_block_time_allocations
    // minutes), so the stub needs raw() as well as fn.
    (billingEngine as any).knex.raw = vi.fn((sql: string) => ({ sql }));

    const eligibleSpy = vi.spyOn(billingEngine as any, 'getEligibleContractLinesForServiceAtDate');
    eligibleSpy.mockImplementation(async ({ serviceId }: { serviceId: string }) => {
      // No candidate carries a profile, so narrowing cannot break the tie and
      // the ambiguous case stays ambiguous — which is the point of the test.
      if (serviceId === 'svc-ambiguous') return [eligibleLine('line-a'), eligibleLine('line-b')];
      if (serviceId === 'svc-single') return [eligibleLine('line-single')];
      if (serviceId === 'svc-none') return [];
      if (serviceId === 'svc-single-usage') return [eligibleLine('line-single-usage')];
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
    expect(timeSelectBuilder.update).not.toHaveBeenCalled();
    expect(usageSelectBuilder.update).not.toHaveBeenCalled();
  });
});
