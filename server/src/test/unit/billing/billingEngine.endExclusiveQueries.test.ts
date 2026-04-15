import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingEngine } from '@alga-psa/billing/services';

const mocks = vi.hoisted(() => ({
  clientServiceConfigs: [] as any[],
}));

vi.mock('@/lib/db/db');
vi.mock('@alga-psa/db', () => ({
  withTransaction: vi.fn(async (_knex, callback) => callback(_knex)),
  withAdminTransaction: vi.fn(async (_callback, existing) => _callback(existing)),
}));
vi.mock('@alga-psa/auth', () => ({
  getSession: vi.fn(() => Promise.resolve({ user: { id: 'mock-user-id' } })),
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: 'mock-user-id',
          tenant: 'test-tenant',
        },
        { tenant: 'test-tenant' },
        ...args,
      ),
}));
vi.mock('server/src/lib/services/clientContractServiceConfigurationService', () => ({
  ClientContractServiceConfigurationService: class {
    async getConfigurationsForClientContractLine(): Promise<any[]> {
      return mocks.clientServiceConfigs;
    }
  },
}));

function createChainableQuery<T>(result: T, whereCalls: Array<unknown[]>): any {
  const builder: any = {};

  const handleWhere = (...args: any[]) => {
    whereCalls.push(args);
    const [first] = args;
    if (typeof first === 'function') {
      first.call(builder, builder);
    }
    return builder;
  };

  builder.join = vi.fn(() => builder);
  builder.leftJoin = vi.fn(() => builder);
  builder.where = vi.fn(handleWhere);
  builder.andWhere = vi.fn(handleWhere);
  builder.orWhere = vi.fn(handleWhere);
  builder.whereIn = vi.fn(() => builder);
  builder.whereNull = vi.fn(() => builder);
  builder.whereNotNull = vi.fn(() => builder);
  builder.select = vi.fn(() => builder);
  builder.first = vi.fn(async () => null);
  builder.raw = vi.fn(() => 'RAW');
  builder.toString = vi.fn(() => 'mocked-query');
  builder.toQuery = vi.fn(() => 'mocked-query');
  builder.then = vi.fn((onFulfilled?: any, onRejected?: any) => {
    const promise = Promise.resolve(result);
    return promise.then(onFulfilled, onRejected);
  });

  return builder;
}

describe('BillingEngine end-exclusive query boundaries', () => {
  let engine: BillingEngine;

  beforeEach(() => {
    mocks.clientServiceConfigs = [];
    engine = new BillingEngine();
    (engine as any).tenant = 'test-tenant';
    (engine as any).initKnex = vi.fn(async () => undefined);
    vi.spyOn(engine as any, 'getBillingCycle').mockResolvedValue('monthly');
    vi.spyOn(engine as any, 'getServiceIdsForContractLine').mockResolvedValue(['service-1']);
    vi.spyOn(engine as any, 'getUniquelyAssignableServiceIdsForLine').mockResolvedValue([]);
  });

  it('does not include time entries exactly at period end boundary (end exclusive)', async () => {
    const whereCalls: Array<unknown[]> = [];
    const billingPeriod = { startDate: '2026-01-01', endDate: '2026-02-01' };

    const mockClientId = 'client-1';
    const clientContractLine = {
      client_contract_line_id: 'ccl-1',
      contract_line_id: 'cl-1',
      currency_code: 'USD',
      client_contract_id: 'cc-1',
      contract_name: 'Contract',
    } as any;

    (engine as any).knex = vi.fn((table: string) => {
      if (table === 'clients') {
        const builder = createChainableQuery(
          { client_id: mockClientId, tenant: 'test-tenant' },
          whereCalls
        );
        builder.first = vi.fn(async () => ({ client_id: mockClientId, tenant: 'test-tenant' }));
        return builder;
      }
      if (table === 'contract_lines') {
        const builder = createChainableQuery(
          { contract_line_id: clientContractLine.contract_line_id, tenant: 'test-tenant' },
          whereCalls
        );
        builder.first = vi.fn(async () => ({ contract_line_id: clientContractLine.contract_line_id, tenant: 'test-tenant' }));
        return builder;
      }
      if (table === 'time_entries') {
        return createChainableQuery([], whereCalls);
      }
      return createChainableQuery([], whereCalls);
    });
    (engine as any).knex.raw = vi.fn(() => 'RAW');

    await (engine as any).calculateTimeBasedCharges(mockClientId, billingPeriod, clientContractLine);

    const endPredicate = whereCalls.find(
      (call) => call[0] === 'time_entries.end_time' && call[1] === '<'
    ) as any[] | undefined;

    expect(endPredicate).toBeDefined();
    expect(endPredicate?.[1]).toBe('<');
    expect(typeof endPredicate?.[2]).toBe('string');
  });

  it('does not include usage records exactly at period end boundary (end exclusive)', async () => {
    const whereCalls: Array<unknown[]> = [];
    const billingPeriod = { startDate: '2026-01-01', endDate: '2026-02-01' };

    const mockClientId = 'client-1';
    const clientContractLine = {
      client_contract_line_id: 'ccl-1',
      contract_line_id: 'cl-1',
      currency_code: 'USD',
      client_contract_id: 'cc-1',
      contract_name: 'Contract',
    } as any;

    (engine as any).knex = vi.fn((table: string) => {
      if (table === 'clients') {
        const builder = createChainableQuery(
          { client_id: mockClientId, tenant: 'test-tenant' },
          whereCalls
        );
        builder.first = vi.fn(async () => ({ client_id: mockClientId, tenant: 'test-tenant' }));
        return builder;
      }
      if (table === 'usage_tracking') {
        return createChainableQuery([], whereCalls);
      }
      return createChainableQuery([], whereCalls);
    });
    (engine as any).knex.raw = vi.fn(() => 'RAW');

    await (engine as any).calculateUsageBasedCharges(mockClientId, billingPeriod, clientContractLine);

    const endPredicate = whereCalls.find(
      (call) => call[0] === 'usage_tracking.usage_date' && call[1] === '<'
    ) as any[] | undefined;

    expect(endPredicate).toBeDefined();
    expect(endPredicate?.[1]).toBe('<');
    expect(typeof endPredicate?.[2]).toBe('string');
  });

  it('T056: hourly recurring billing queries approved time entries inside the canonical persisted service window when it differs from the invoice window', async () => {
    const whereCalls: Array<unknown[]> = [];
    const billingPeriod = { startDate: '2026-02-01', endDate: '2026-03-01' };
    const recurringTimingSelection = {
      duePosition: 'arrears',
      servicePeriodStart: '2026-01-15',
      servicePeriodEnd: '2026-02-14',
      servicePeriodStartExclusive: '2026-01-15',
      servicePeriodEndExclusive: '2026-02-15',
      coverageRatio: 1,
    };

    const mockClientId = 'client-1';
    const clientContractLine = {
      client_contract_line_id: 'ccl-1',
      contract_line_id: 'cl-1',
      contract_line_type: 'Hourly',
      currency_code: 'USD',
      client_contract_id: 'cc-1',
      contract_name: 'Contract',
      cadence_owner: 'contract',
      billing_timing: 'arrears',
      billing_frequency: 'monthly',
    } as any;

    (engine as any).knex = vi.fn((table: string) => {
      if (table === 'clients') {
        const builder = createChainableQuery(
          { client_id: mockClientId, tenant: 'test-tenant' },
          whereCalls
        );
        builder.first = vi.fn(async () => ({ client_id: mockClientId, tenant: 'test-tenant' }));
        return builder;
      }
      if (table === 'contract_lines') {
        const builder = createChainableQuery(
          { contract_line_id: clientContractLine.contract_line_id, tenant: 'test-tenant' },
          whereCalls
        );
        builder.first = vi.fn(async () => ({
          contract_line_id: clientContractLine.contract_line_id,
          tenant: 'test-tenant',
          enable_overtime: false,
          overtime_threshold: null,
          overtime_rate: null,
        }));
        return builder;
      }
      if (table === 'time_entries') {
        return createChainableQuery([], whereCalls);
      }
      return createChainableQuery([], whereCalls);
    });
    (engine as any).knex.raw = vi.fn(() => 'RAW');

    await (engine as any).calculateTimeBasedCharges(
      mockClientId,
      billingPeriod,
      clientContractLine,
      undefined,
      recurringTimingSelection,
      'persisted',
    );

    const startPredicate = whereCalls.find(
      (call) => call[0] === 'time_entries.start_time' && call[1] === '>='
    ) as any[] | undefined;
    const endPredicate = whereCalls.find(
      (call) => call[0] === 'time_entries.end_time' && call[1] === '<'
    ) as any[] | undefined;

    expect(startPredicate?.[2]).toBe(recurringTimingSelection.servicePeriodStartExclusive);
    expect(endPredicate?.[2]).toBe(recurringTimingSelection.servicePeriodEndExclusive);
    expect(startPredicate?.[2]).not.toBe(billingPeriod.startDate);
    expect(endPredicate?.[2]).not.toBe(billingPeriod.endDate);
  });

  it('T119: hourly recurring charges preserve config_id from the client line service configuration', async () => {
    const whereCalls: Array<unknown[]> = [];
    const billingPeriod = { startDate: '2026-02-01', endDate: '2026-03-01' };
    const mockClientId = 'client-1';
    const clientContractLine = {
      client_contract_line_id: 'ccl-1',
      contract_line_id: 'cl-1',
      contract_line_type: 'Hourly',
      currency_code: 'USD',
      client_contract_id: 'cc-1',
      contract_name: 'Contract',
      cadence_owner: 'client',
      billing_timing: 'arrears',
      billing_frequency: 'monthly',
    } as any;

    (engine as any).knex = vi.fn((table: string) => {
      if (table === 'clients') {
        const builder = createChainableQuery(
          { client_id: mockClientId, tenant: 'test-tenant', is_tax_exempt: false },
          whereCalls
        );
        builder.first = vi.fn(async () => ({ client_id: mockClientId, tenant: 'test-tenant', is_tax_exempt: false }));
        return builder;
      }
      if (table === 'contract_lines') {
        const builder = createChainableQuery(
          { contract_line_id: clientContractLine.contract_line_id, tenant: 'test-tenant' },
          whereCalls
        );
        builder.first = vi.fn(async () => ({
          contract_line_id: clientContractLine.contract_line_id,
          tenant: 'test-tenant',
          enable_overtime: false,
          overtime_threshold: null,
          overtime_rate: null,
        }));
        return builder;
      }
      if (table === 'contract_line_services as cls') {
        return createChainableQuery([
          {
            config_id: 'config-hourly-1',
            configuration_type: 'Hourly',
            custom_rate: null,
            quantity: null,
            created_at: new Date('2026-01-01T00:00:00.000Z'),
            updated_at: new Date('2026-01-01T00:00:00.000Z'),
            contract_line_id: clientContractLine.contract_line_id,
            service_id: 'service-1',
          },
        ], whereCalls);
      }
      if (table === 'contract_line_service_hourly_configs') {
        const builder = createChainableQuery([], whereCalls);
        builder.first = vi.fn(async () => null);
        return builder;
      }
      if (table === 'contract_line_service_hourly_config') {
        const builder = createChainableQuery([], whereCalls);
        builder.first = vi.fn(async () => ({
          config_id: 'config-hourly-1',
          minimum_billable_time: 0,
          round_up_to_nearest: 0,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
        }));
        return builder;
      }
      if (table === 'user_type_rates') {
        return createChainableQuery([], whereCalls);
      }
      if (table === 'time_entries') {
        return createChainableQuery([
          {
            entry_id: 'entry-1',
            user_id: 'user-1',
            service_id: 'service-1',
            service_name: 'Software Development',
            default_rate: 15000,
            tax_rate_id: null,
            start_time: new Date('2026-02-13T10:00:00.000Z'),
            end_time: new Date('2026-02-13T11:00:00.000Z'),
            user_type: 'technician',
          },
        ], whereCalls);
      }
      return createChainableQuery([], whereCalls);
    });
    (engine as any).knex.raw = vi.fn(() => 'RAW');
    vi.spyOn(engine as any, 'getUniquelyAssignableServiceIdsForLine').mockResolvedValue([]);
    vi.spyOn(engine as any, 'getTaxInfoFromService').mockResolvedValue({
      taxRegion: undefined,
      isTaxable: false,
    });
    vi.spyOn(engine as any, 'getClientDefaultTaxRegionCode').mockResolvedValue('US-NY');

    const charges = await (engine as any).calculateTimeBasedCharges(
      mockClientId,
      billingPeriod,
      clientContractLine,
    );

    expect(charges).toEqual([
      expect.objectContaining({
        type: 'time',
        entryId: 'entry-1',
        serviceId: 'service-1',
        config_id: 'config-hourly-1',
        client_contract_line_id: 'ccl-1',
      }),
    ]);
  });

  it('T057: usage recurring billing queries usage records inside the canonical persisted service window when it differs from the invoice window', async () => {
    const whereCalls: Array<unknown[]> = [];
    const billingPeriod = { startDate: '2026-02-01', endDate: '2026-03-01' };
    const recurringTimingSelection = {
      duePosition: 'arrears',
      servicePeriodStart: '2026-01-15',
      servicePeriodEnd: '2026-02-14',
      servicePeriodStartExclusive: '2026-01-15',
      servicePeriodEndExclusive: '2026-02-15',
      coverageRatio: 1,
    };

    const mockClientId = 'client-1';
    const clientContractLine = {
      client_contract_line_id: 'ccl-1',
      contract_line_id: 'cl-1',
      contract_line_type: 'Usage',
      currency_code: 'USD',
      client_contract_id: 'cc-1',
      contract_name: 'Contract',
      cadence_owner: 'contract',
      billing_timing: 'arrears',
      billing_frequency: 'monthly',
    } as any;

    (engine as any).knex = vi.fn((table: string) => {
      if (table === 'clients') {
        const builder = createChainableQuery(
          { client_id: mockClientId, tenant: 'test-tenant' },
          whereCalls
        );
        builder.first = vi.fn(async () => ({ client_id: mockClientId, tenant: 'test-tenant' }));
        return builder;
      }
      if (table === 'usage_tracking') {
        return createChainableQuery([], whereCalls);
      }
      return createChainableQuery([], whereCalls);
    });
    (engine as any).knex.raw = vi.fn(() => 'RAW');

    await (engine as any).calculateUsageBasedCharges(
      mockClientId,
      billingPeriod,
      clientContractLine,
      undefined,
      recurringTimingSelection,
      'persisted',
    );

    const startPredicate = whereCalls.find(
      (call) => call[0] === 'usage_tracking.usage_date' && call[1] === '>='
    ) as any[] | undefined;
    const endPredicate = whereCalls.find(
      (call) => call[0] === 'usage_tracking.usage_date' && call[1] === '<'
    ) as any[] | undefined;

    expect(startPredicate?.[2]).toBe(recurringTimingSelection.servicePeriodStartExclusive);
    expect(endPredicate?.[2]).toBe(recurringTimingSelection.servicePeriodEndExclusive);
    expect(startPredicate?.[2]).not.toBe(billingPeriod.startDate);
    expect(endPredicate?.[2]).not.toBe(billingPeriod.endDate);
  });
});
