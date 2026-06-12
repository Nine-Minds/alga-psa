import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runWithTenant: vi.fn(),
  getConnection: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock('server/src/lib/db', () => ({
  runWithTenant: mocks.runWithTenant,
}));

vi.mock('server/src/lib/db/db', () => ({
  getConnection: mocks.getConnection,
}));

vi.mock('server/src/lib/logging/auditLog', () => ({
  auditLog: mocks.auditLog,
}));

import { expiredCreditsHandler } from 'server/src/lib/jobs/handlers/expiredCreditsHandler';

const TENANT = 'tenant-1';

interface FakeDbState {
  creditTracking: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  clients: Record<string, unknown>[];
  insertedTransactions: Record<string, unknown>[];
  creditTrackingUpdates: { where: Record<string, unknown>; update: Record<string, unknown> }[];
  clientUpdates: { where: Record<string, unknown>; update: Record<string, unknown> }[];
  rawCalls: unknown[][];
}

/**
 * Minimal chainable knex stand-in that supports the exact query shapes used by
 * expiredCreditsHandler. Reads resolve from in-memory fixtures; writes are recorded.
 */
function buildFakeKnex(state: FakeDbState) {
  const matches = (row: Record<string, unknown>, filters: Record<string, unknown>) =>
    Object.entries(filters).every(([key, value]) => row[key] === value);

  const makeBuilder = (table: string) => {
    const objectFilters: Record<string, unknown> = {};

    const builder: any = {
      where(arg1: unknown, arg2?: unknown, arg3?: unknown) {
        if (typeof arg1 === 'object' && arg1 !== null) {
          Object.assign(objectFilters, arg1);
        } else if (arg3 === undefined) {
          objectFilters[arg1 as string] = arg2;
        }
        // Operator-based filters (e.g. '<', '>') are accepted but not evaluated;
        // fixtures are pre-filtered for the scenarios under test.
        return builder;
      },
      whereNotNull: () => builder,
      first: async () => {
        const rows = table === 'transactions' ? state.transactions : state.clients;
        return rows.find((row) => matches(row as Record<string, unknown>, objectFilters));
      },
      select: async (..._columns: string[]) => {
        if (table === 'clients') {
          return state.clients.filter((row) => matches(row as Record<string, unknown>, objectFilters));
        }
        throw new Error(`Unexpected select on table ${table}`);
      },
      insert: async (row: Record<string, unknown>) => {
        if (table !== 'transactions') throw new Error(`Unexpected insert on table ${table}`);
        state.insertedTransactions.push(row);
      },
      update: async (update: Record<string, unknown>) => {
        if (table === 'credit_tracking') {
          state.creditTrackingUpdates.push({ where: { ...objectFilters }, update });
        } else if (table === 'clients') {
          state.clientUpdates.push({ where: { ...objectFilters }, update });
        } else {
          throw new Error(`Unexpected update on table ${table}`);
        }
      },
      // The expired-credits selection query is awaited directly.
      then(resolve: (rows: unknown[]) => unknown, reject: (err: unknown) => unknown) {
        if (table !== 'credit_tracking') {
          return Promise.reject(new Error(`Unexpected awaited query on table ${table}`)).then(resolve, reject);
        }
        return Promise.resolve(
          state.creditTracking.filter((row) => matches(row as Record<string, unknown>, { tenant: objectFilters.tenant, is_expired: objectFilters.is_expired, ...(objectFilters.client_id !== undefined ? { client_id: objectFilters.client_id } : {}) })),
        ).then(resolve, reject);
      },
    };
    return builder;
  };

  const trx: any = (table: string) => makeBuilder(table);
  trx.raw = async (...args: unknown[]) => {
    state.rawCalls.push(args);
  };

  return {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(trx),
  };
}

function buildState(overrides: Partial<FakeDbState> = {}): FakeDbState {
  return {
    creditTracking: [
      {
        credit_id: 'credit-1',
        tenant: TENANT,
        client_id: 'client-1',
        transaction_id: 'txn-original-1',
        is_expired: false,
        expiration_date: '2026-01-01T00:00:00.000Z',
        remaining_amount: 2500,
      },
    ],
    transactions: [
      { transaction_id: 'txn-original-1', tenant: TENANT, type: 'credit_issuance' },
    ],
    clients: [
      { client_id: 'client-1', tenant: TENANT, credit_balance: 10000 },
    ],
    insertedTransactions: [],
    creditTrackingUpdates: [],
    clientUpdates: [],
    rawCalls: [],
    ...overrides,
  };
}

describe('expiredCreditsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.runWithTenant.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    mocks.auditLog.mockResolvedValue(undefined);
  });

  it('should throw when tenantId is missing without touching the database', async () => {
    await expect(expiredCreditsHandler({ tenantId: '' } as any)).rejects.toThrow(
      'Tenant ID is required for expired credits job',
    );
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });

  it('should expire a credit: create the expiration transaction, zero the credit, and reduce the client balance', async () => {
    const state = buildState();
    mocks.getConnection.mockResolvedValue(buildFakeKnex(state));

    await expiredCreditsHandler({ tenantId: TENANT });

    // Tenant/user context set for triggers + auditing inside the transaction
    expect(state.rawCalls).toEqual(
      expect.arrayContaining([
        ['select set_config(?, ?, true)', ['app.current_tenant', TENANT]],
        ['select set_config(?, ?, true)', ['app.current_user', 'system']],
      ]),
    );

    // Expiration transaction reverses the remaining amount and records the running balance
    expect(state.insertedTransactions).toHaveLength(1);
    expect(state.insertedTransactions[0]).toMatchObject({
      client_id: 'client-1',
      amount: -2500,
      type: 'credit_expiration',
      status: 'completed',
      balance_after: 7500,
      tenant: TENANT,
      related_transaction_id: 'txn-original-1',
    });

    // Credit is marked expired with no remaining amount
    expect(state.creditTrackingUpdates).toHaveLength(1);
    expect(state.creditTrackingUpdates[0].where).toMatchObject({ credit_id: 'credit-1', tenant: TENANT });
    expect(state.creditTrackingUpdates[0].update).toMatchObject({ is_expired: true, remaining_amount: 0 });

    // Client balance reduced by the expired amount
    expect(state.clientUpdates).toHaveLength(1);
    expect(state.clientUpdates[0].where).toMatchObject({ client_id: 'client-1', tenant: TENANT });
    expect(state.clientUpdates[0].update).toMatchObject({ credit_balance: 7500 });

    // Expiration is audit logged as the system user
    expect(mocks.auditLog).toHaveBeenCalledTimes(1);
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'system',
        operation: 'credit_expiration',
        tableName: 'credit_tracking',
        recordId: 'credit-1',
      }),
    );
  });

  it('should be idempotent: skip credits that already have a credit_expiration transaction', async () => {
    const state = buildState({
      transactions: [
        { transaction_id: 'txn-original-1', tenant: TENANT, type: 'credit_issuance' },
        {
          transaction_id: 'txn-expiration-1',
          tenant: TENANT,
          type: 'credit_expiration',
          related_transaction_id: 'txn-original-1',
        },
      ],
    });
    mocks.getConnection.mockResolvedValue(buildFakeKnex(state));

    await expiredCreditsHandler({ tenantId: TENANT });

    // No duplicate side effects for an already-expired credit
    expect(state.insertedTransactions).toHaveLength(0);
    expect(state.creditTrackingUpdates).toHaveLength(0);
    expect(state.clientUpdates).toHaveLength(0);
    expect(mocks.auditLog).not.toHaveBeenCalled();
  });

  it('should only process credits for the requested client when clientId is provided', async () => {
    const state = buildState({
      creditTracking: [
        {
          credit_id: 'credit-1',
          tenant: TENANT,
          client_id: 'client-1',
          transaction_id: 'txn-original-1',
          is_expired: false,
          expiration_date: '2026-01-01T00:00:00.000Z',
          remaining_amount: 2500,
        },
        {
          credit_id: 'credit-other',
          tenant: TENANT,
          client_id: 'client-other',
          transaction_id: 'txn-other',
          is_expired: false,
          expiration_date: '2026-01-01T00:00:00.000Z',
          remaining_amount: 100,
        },
      ],
    });
    mocks.getConnection.mockResolvedValue(buildFakeKnex(state));

    await expiredCreditsHandler({ tenantId: TENANT, clientId: 'client-1' });

    expect(state.insertedTransactions).toHaveLength(1);
    expect(state.insertedTransactions[0]).toMatchObject({ client_id: 'client-1' });
  });

  it('should re-throw when the original transaction backing a credit is missing', async () => {
    const state = buildState({ transactions: [] });
    mocks.getConnection.mockResolvedValue(buildFakeKnex(state));

    await expect(expiredCreditsHandler({ tenantId: TENANT })).rejects.toThrow(
      'Original transaction txn-original-1 not found for credit credit-1',
    );

    // The failed credit must not produce partial side effects
    expect(state.insertedTransactions).toHaveLength(0);
    expect(state.creditTrackingUpdates).toHaveLength(0);
    expect(state.clientUpdates).toHaveLength(0);
  });

  it('should re-throw when the client owning the credit is missing', async () => {
    const state = buildState({ clients: [] });
    mocks.getConnection.mockResolvedValue(buildFakeKnex(state));

    await expect(expiredCreditsHandler({ tenantId: TENANT })).rejects.toThrow(
      'Client client-1 not found',
    );
    expect(state.insertedTransactions).toHaveLength(0);
  });
});
