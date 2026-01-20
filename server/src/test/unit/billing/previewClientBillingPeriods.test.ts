import { describe, expect, it, vi, beforeEach } from 'vitest';

type Call =
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

  first(): this {
    this.isFirst = true;
    return this;
  }

  select(...args: unknown[]): any {
    this.calls.push({ table: this.table, method: 'select', args, where: this.whereClauses, andWhere: this.andWhereClauses });
    const key = `${this.table}:select:${this.isFirst ? 'first' : 'many'}`;
    return Promise.resolve(this.responses[key]);
  }
}

function makeFakeTransaction(responses: Record<string, any>): { trx: any; calls: Call[] } {
  const calls: Call[] = [];
  const trx: any = (table: string) => new FakeQuery(table, calls, responses);
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

describe('previewClientBillingPeriods', () => {
  beforeEach(() => {
    currentTrx = null;
    vi.resetModules();
  });

  it('returns consecutive upcoming periods based on stored billing cycle + anchor settings', async () => {
    const responses = {
      'clients:select:first': { billing_cycle: 'monthly' },
      'client_billing_settings:select:first': { billing_cycle_anchor_day_of_month: 10 },
    };
    const { trx } = makeFakeTransaction(responses);
    currentTrx = trx;
    const { previewClientBillingPeriods } = await import('@alga-psa/billing/actions');

    const periods = await previewClientBillingPeriods('client-1', {
      count: 3,
      referenceDate: '2026-01-09T00:00:00Z',
    });

    expect(periods).toEqual([
      { periodStartDate: '2025-12-10T00:00:00Z', periodEndDate: '2026-01-10T00:00:00Z' },
      { periodStartDate: '2026-01-10T00:00:00Z', periodEndDate: '2026-02-10T00:00:00Z' },
      { periodStartDate: '2026-02-10T00:00:00Z', periodEndDate: '2026-03-10T00:00:00Z' },
    ]);
  });
});
