import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';

vi.mock('@/lib/db/db');
vi.mock('@alga-psa/shared/db', () => ({
  withTransaction: vi.fn(async (_knex, callback) => callback(_knex)),
  withAdminTransaction: vi.fn(async (_callback, existing) => _callback(existing)),
}));
vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(() => Promise.resolve({ user: { id: 'mock-user-id' } })),
}));
vi.mock('server/src/lib/services/clientContractServiceConfigurationService', () => ({
  ClientContractServiceConfigurationService: class {
    async getConfigurationsForClientContractLine(): Promise<any[]> {
      return [];
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
    engine = new BillingEngine();
    (engine as any).tenant = 'test-tenant';
    (engine as any).initKnex = vi.fn(async () => undefined);
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
    expect(endPredicate?.[2]).toBe(billingPeriod.endDate);
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
    expect(endPredicate?.[2]).toBe(billingPeriod.endDate);
  });
});
