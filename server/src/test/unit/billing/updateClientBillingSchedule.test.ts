import { describe, expect, it, vi, beforeEach } from 'vitest';

type Call =
  | { table: string; method: 'update'; args: unknown[]; where?: unknown[]; andWhere?: unknown[] }
  | { table: string; method: 'select'; args: unknown[]; where?: unknown[]; andWhere?: unknown[] };

class FakeQuery {
  private readonly calls: Call[];
  private readonly table: string;
  private readonly responses: Record<string, any>;
  private whereClauses: unknown[] = [];
  private andWhereClauses: unknown[] = [];
  private isFirst = false;

  constructor(table: string, calls: Call[], responses: Record<string, any>) {
    this.table = table;
    this.calls = calls;
    this.responses = responses;
  }

  where(...args: unknown[]): this {
    this.whereClauses.push(args);
    return this;
  }

  andWhere(...args: unknown[]): this {
    this.andWhereClauses.push(args);
    return this;
  }

  whereIn(): this {
    return this;
  }

  leftJoin(): this {
    return this;
  }

  join(_table: string, onFn: Function): this {
    const clause = {
      on: () => clause,
      andOn: () => clause,
    };
    onFn.call(clause);
    return this;
  }

  orderBy(): this {
    return this;
  }

  first(): this {
    this.isFirst = true;
    return this;
  }

  select(...args: unknown[]): any {
    this.calls.push({ table: this.table, method: 'select', args, where: this.whereClauses, andWhere: this.andWhereClauses });
    const key = `${this.table}:select:${this.isFirst ? 'first' : 'many'}`;
    return Promise.resolve(this.responses[key]);
  }

  whereNotExists(subqueryFn: Function): this {
    const builder = {
      select: () => builder,
      from: () => builder,
      whereRaw: () => builder,
      andWhereRaw: () => builder,
    };
    subqueryFn.call(builder);
    return this;
  }

  update(...args: unknown[]): any {
    this.calls.push({ table: this.table, method: 'update', args, where: this.whereClauses, andWhere: this.andWhereClauses });
    return Promise.resolve(1);
  }
}

function makeFakeTransaction(responses: Record<string, any>): { trx: any; calls: Call[] } {
  const calls: Call[] = [];
  const trx: any = (table: string) => new FakeQuery(table, calls, responses);
  trx.fn = { now: () => 'NOW' };
  return { trx, calls };
}

let currentTrx: any | null = null;

vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_knex: any, fn: any) => {
    if (!currentTrx) throw new Error('No test transaction configured');
    return await fn(currentTrx);
  },
}));

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({ user: { id: 'user-1' } })),
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
}));

const mockEnsureClientBillingSettingsRow = vi.fn(async () => undefined);

vi.mock('server/src/lib/actions/billingCycleAnchorActions', async () => {
  const actual = await vi.importActual<any>('server/src/lib/actions/billingCycleAnchorActions');
  return {
    ...actual,
    ensureClientBillingSettingsRow: (...args: any[]) => mockEnsureClientBillingSettingsRow(...args),
  };
});

describe('updateClientBillingSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTrx = null;
    vi.resetModules();
  });

  it('updates billing cycle + anchor and deactivates future non-invoiced cycles at/after cutover', async () => {
    const responses = {
      'clients:select:first': { client_id: 'client-1', billing_cycle: 'monthly' },
      'client_billing_cycles as cbc:select:first': { period_end_date: '2026-01-01T00:00:00Z' },
    };
    const { trx, calls } = makeFakeTransaction(responses);
    currentTrx = trx;
    const { updateClientBillingSchedule: updateWithMock } = await import('server/src/lib/actions/billingScheduleActions');

    await updateWithMock({
      clientId: 'client-1',
      billingCycle: 'quarterly',
      anchor: { monthOfYear: 1, dayOfMonth: 10 }
    });

    expect(mockEnsureClientBillingSettingsRow).toHaveBeenCalled();

    const clientUpdate = calls.find(c => c.method === 'update' && c.table === 'clients') as any;
    expect(clientUpdate).toBeTruthy();
    expect(clientUpdate.args[0]).toMatchObject({ billing_cycle: 'quarterly' });

    const settingsUpdate = calls.find(c => c.method === 'update' && c.table === 'client_billing_settings') as any;
    expect(settingsUpdate).toBeTruthy();
    expect(settingsUpdate.args[0]).toMatchObject({
      billing_cycle_anchor_day_of_month: 10,
      billing_cycle_anchor_month_of_year: 1,
    });

    const deactivateUpdate = calls.find(c => c.method === 'update' && c.table === 'client_billing_cycles') as any;
    expect(deactivateUpdate).toBeTruthy();
    expect(deactivateUpdate.args[0]).toMatchObject({ is_active: false });

    const hasCutoverFilter = (deactivateUpdate.andWhere ?? []).some((clause: any) => clause[0] === 'period_start_date' && clause[1] === '>=' && clause[2] === '2026-01-01T00:00:00Z');
    expect(hasCutoverFilter).toBe(true);
  });

  it('does not apply a cutover filter when there are no invoiced cycles', async () => {
    const responses = {
      'clients:select:first': { client_id: 'client-1', billing_cycle: 'monthly' },
      'client_billing_cycles as cbc:select:first': null,
    };
    const { trx, calls } = makeFakeTransaction(responses);
    currentTrx = trx;
    const { updateClientBillingSchedule: updateWithMock } = await import('server/src/lib/actions/billingScheduleActions');

    await updateWithMock({
      clientId: 'client-1',
      billingCycle: 'monthly',
      anchor: { dayOfMonth: 10 }
    });

    const clientUpdate = calls.find(c => c.method === 'update' && c.table === 'clients') as any;
    expect(clientUpdate).toBeFalsy();

    const deactivateUpdate = calls.find(c => c.method === 'update' && c.table === 'client_billing_cycles') as any;
    expect(deactivateUpdate).toBeTruthy();

    const hasCutoverFilter = (deactivateUpdate.andWhere ?? []).some((clause: any) => clause[0] === 'period_start_date' && clause[1] === '>=');
    expect(hasCutoverFilter).toBe(false);
  });
});
