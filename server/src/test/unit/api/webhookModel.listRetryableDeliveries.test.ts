import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const WEBHOOK_ID = '22222222-2222-4222-8222-222222222222';

type QueryCall = {
  table: string;
  where: unknown[];
  whereIn: Array<[string, unknown]>;
  orderBy: Array<[string, string]>;
  limit: number | null;
  counted: boolean;
};

const state = vi.hoisted(() => ({
  calls: [] as any[],
  tenantScopes: [] as string[],
  rows: [] as any[],
  count: '0',
}));

const getConnectionMock = vi.hoisted(() => vi.fn(async () => ({ fn: { now: () => 'now()' } })));

vi.mock('@/lib/db/db', () => ({
  getConnection: getConnectionMock,
}));

vi.mock('@alga-psa/db', () => {
  function makeBuilder(table: string) {
    const call: QueryCall = {
      table,
      where: [],
      whereIn: [],
      orderBy: [],
      limit: null,
      counted: false,
    };
    state.calls.push(call);

    const builder: any = {
      where: (...args: unknown[]) => {
        call.where.push(args.length === 1 ? args[0] : args);
        return builder;
      },
      whereIn: (column: string, values: unknown) => {
        call.whereIn.push([column, values]);
        return builder;
      },
      orderBy: (column: string, direction: string) => {
        call.orderBy.push([column, direction]);
        return builder;
      },
      limit: (value: number) => {
        call.limit = value;
        return builder;
      },
      count: () => {
        call.counted = true;
        return builder;
      },
      first: async () => ({ count: state.count }),
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(state.rows).then(resolve),
    };

    return builder;
  }

  return {
    tenantDb: (_conn: unknown, tenant: string) => {
      state.tenantScopes.push(tenant);
      return { table: (table: string) => makeBuilder(table) };
    },
  };
});

describe('webhookModel.listRetryableDeliveries', () => {
  beforeEach(() => {
    state.calls = [];
    state.tenantScopes = [];
    state.rows = [];
    state.count = '0';
    getConnectionMock.mockClear();
  });

  it('selects only terminal non-test failures for the tenant, oldest first', async () => {
    const { webhookModel } = await import('@/lib/webhooks/webhookModel');

    state.count = '7';
    state.rows = [
      {
        tenant: TENANT_ID,
        delivery_id: '44444444-4444-4444-8444-444444444444',
        webhook_id: WEBHOOK_ID,
        event_id: '33333333-3333-4333-8333-333333333333',
        event_type: 'ticket.updated',
        status: 'failed',
        attempt_number: 5,
        is_test: false,
        attempted_at: new Date('2026-10-01T00:00:00.000Z'),
      },
    ];

    const result = await webhookModel.listRetryableDeliveries(TENANT_ID, WEBHOOK_ID, { limit: 25 });

    expect(result.totalCandidates).toBe(7);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.deliveryId).toBe('44444444-4444-4444-8444-444444444444');

    expect(getConnectionMock).toHaveBeenCalledWith(TENANT_ID);
    expect(state.tenantScopes).toEqual([TENANT_ID]);

    // Two queries: the page of candidates and the matching total.
    expect(state.calls).toHaveLength(2);
    const [page, total] = state.calls as QueryCall[];

    for (const call of [page, total]) {
      expect(call.table).toBe('webhook_deliveries');
      expect(call.where).toEqual([{ webhook_id: WEBHOOK_ID, is_test: false }]);
      expect(call.whereIn).toEqual([['status', ['failed', 'abandoned']]]);
    }

    expect(page.orderBy).toEqual([['attempted_at', 'asc']]);
    expect(page.limit).toBe(25);
    expect(total.counted).toBe(true);
    expect(total.limit).toBeNull();
  });

  it('never considers retrying, pending or delivered rows', async () => {
    const { webhookModel } = await import('@/lib/webhooks/webhookModel');

    await webhookModel.listRetryableDeliveries(TENANT_ID, WEBHOOK_ID, { limit: 10 });

    const statuses = (state.calls as QueryCall[]).flatMap((call) =>
      call.whereIn.flatMap(([, values]) => values as string[]),
    );
    expect(statuses).not.toContain('retrying');
    expect(statuses).not.toContain('pending');
    expect(statuses).not.toContain('delivered');
  });

  it('applies the since lower bound to attempted_at only when supplied', async () => {
    const { webhookModel } = await import('@/lib/webhooks/webhookModel');

    const since = new Date('2026-09-30T12:00:00.000Z');
    await webhookModel.listRetryableDeliveries(TENANT_ID, WEBHOOK_ID, { limit: 10, since });

    for (const call of state.calls as QueryCall[]) {
      expect(call.where).toContainEqual(['attempted_at', '>=', since]);
    }

    state.calls = [];
    await webhookModel.listRetryableDeliveries(TENANT_ID, WEBHOOK_ID, { limit: 10 });
    for (const call of state.calls as QueryCall[]) {
      expect(call.where).toEqual([{ webhook_id: WEBHOOK_ID, is_test: false }]);
    }
  });

  it('floors a non-positive limit at one row', async () => {
    const { webhookModel } = await import('@/lib/webhooks/webhookModel');

    await webhookModel.listRetryableDeliveries(TENANT_ID, WEBHOOK_ID, { limit: 0 });

    expect((state.calls[0] as QueryCall).limit).toBe(1);
  });
});
