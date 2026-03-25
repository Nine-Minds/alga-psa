import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ISO8601String } from '@alga-psa/types';
import { updateClientBillingSchedule } from '../billingClients/billingSchedule';

vi.mock('../billingClients/billingSettings', () => ({
  ensureClientBillingSettingsRow: vi.fn(async () => undefined),
}));

type Row = Record<string, any>;

type DbState = {
  clients: Row[];
  client_billing_settings: Row[];
  client_billing_cycles: Row[];
  invoices: Row[];
};

function cloneState(state: DbState): DbState {
  return {
    clients: state.clients.map((row) => ({ ...row })),
    client_billing_settings: state.client_billing_settings.map((row) => ({ ...row })),
    client_billing_cycles: state.client_billing_cycles.map((row) => ({ ...row })),
    invoices: state.invoices.map((row) => ({ ...row })),
  };
}

function normalizeTableName(table: string): keyof DbState {
  const base = table.split(/\s+as\s+/i)[0] as keyof DbState;
  return base;
}

class FakeQuery {
  private predicates: Array<(row: Row) => boolean> = [];
  private sorters: Array<{ field: string; dir: 'asc' | 'desc' }> = [];
  private firstMode = false;
  private selectedFields: string[] | null = null;
  private countAlias: string | null = null;
  private requireInvoicedJoin = false;
  private requireNoInvoice = false;

  constructor(
    private readonly state: DbState,
    private readonly table: keyof DbState,
    private readonly fnNow: () => string,
  ) {}

  private normalizeFieldName(field: string): string {
    return field.includes('.') ? field.split('.').pop()! : field;
  }

  where(arg1: any, arg2?: any, arg3?: any): this {
    if (typeof arg1 === 'object' && arg1 !== null && arg2 === undefined) {
      for (const [key, value] of Object.entries(arg1)) {
        this.predicates.push((row) => row[key] === value);
      }
      return this;
    }

    if (typeof arg1 === 'string' && arg3 !== undefined) {
      const field = this.normalizeFieldName(arg1);
      const op = String(arg2);
      const value = arg3;
      this.predicates.push((row) => {
        const left = row[field];
        if (op === '>=') return left >= value;
        if (op === '>') return left > value;
        if (op === '<=') return left <= value;
        if (op === '<') return left < value;
        return left === value;
      });
      return this;
    }

    if (typeof arg1 === 'string' && arg2 !== undefined) {
      const field = this.normalizeFieldName(arg1);
      const value = arg2;
      this.predicates.push((row) => row[field] === value);
    }

    return this;
  }

  andWhere(arg1: any, arg2?: any, arg3?: any): this {
    return this.where(arg1, arg2, arg3);
  }

  join(table: string, _onFn: Function): this {
    if (normalizeTableName(table) === 'invoices') {
      this.requireInvoicedJoin = true;
    }
    return this;
  }

  leftJoin(): this {
    return this;
  }

  whereNotExists(_subqueryFn: Function): this {
    this.requireNoInvoice = true;
    return this;
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): this {
    this.sorters.push({ field, dir });
    return this;
  }

  first(...fields: string[]): this | Promise<any> {
    this.firstMode = true;
    if (fields.length > 0) {
      this.selectedFields = fields;
      return this.execute();
    }
    return this;
  }

  count(...args: any[]): this {
    const countArg = typeof args[0] === 'string' ? args[0] : null;
    if (countArg && /\sas\s/i.test(countArg)) {
      const [, alias] = countArg.split(/\s+as\s+/i);
      this.countAlias = alias?.trim() ?? 'count';
    } else {
      this.countAlias = 'count';
    }
    return this;
  }

  select(...fields: string[]): Promise<any> {
    this.selectedFields = fields;
    return this.execute();
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<any> {
    const rows = this.resolveRows();
    const mapped = this.selectedFields?.length
      ? rows.map((row) => {
          const out: Row = {};
          for (const field of this.selectedFields ?? []) {
            const [left, right] = field.split(/\s+as\s+/i);
            const source = left.includes('.') ? left.split('.').pop()! : left;
            const target = right ? right.trim() : source;
            out[target] = row[source];
          }
          return out;
        })
      : rows;

    if (this.countAlias) {
      const payload = { [this.countAlias]: String(rows.length) };
      return this.firstMode ? payload : [payload];
    }

    if (this.firstMode) {
      return mapped[0] ?? null;
    }

    return mapped;
  }

  async update(payload: Row): Promise<number> {
    const rows = this.resolveRows({ mutable: true });
    for (const row of rows) {
      Object.assign(row, payload, { updated_at: row.updated_at ?? this.fnNow() });
    }
    return rows.length;
  }

  async del(): Promise<number> {
    const source = this.state[this.table];
    const toDelete = new Set(this.resolveRows().map((row) => row.__row_id));
    const before = source.length;
    this.state[this.table] = source.filter((row) => !toDelete.has(row.__row_id));
    return before - this.state[this.table].length;
  }

  async insert(payload: Row | Row[]): Promise<number> {
    const rows = Array.isArray(payload) ? payload : [payload];
    const target = this.state[this.table];
    for (const row of rows) {
      target.push({
        billing_cycle_id: row.billing_cycle_id ?? `cycle-${target.length + 1}`,
        ...row,
        __row_id: `${this.table}-${target.length + 1}-${Math.random()}`,
      });
    }
    return rows.length;
  }

  private resolveRows(options: { mutable?: boolean } = {}): Row[] {
    const base: Row[] = this.state[this.table].map((row, idx) => ({ ...row, __row_id: row.__row_id ?? `${this.table}-${idx}` }));

    let filtered: Row[] = base.filter((row) => this.predicates.every((predicate) => predicate(row)));

    if (this.requireInvoicedJoin) {
      filtered = filtered.filter((row) => this.state.invoices.some((invoice) =>
        invoice.tenant === row.tenant && invoice.billing_cycle_id === row.billing_cycle_id,
      ));
    }

    if (this.requireNoInvoice) {
      filtered = filtered.filter((row) => !this.state.invoices.some((invoice) =>
        invoice.tenant === row.tenant && invoice.billing_cycle_id === row.billing_cycle_id,
      ));
    }

    for (const sorter of this.sorters) {
      filtered.sort((a, b) => {
        const av = a[sorter.field.includes('.') ? sorter.field.split('.').pop()! : sorter.field];
        const bv = b[sorter.field.includes('.') ? sorter.field.split('.').pop()! : sorter.field];
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return sorter.dir === 'desc' ? -cmp : cmp;
      });
    }

    if (options.mutable) {
      return this.state[this.table].filter((row) =>
        filtered.some((candidate) => candidate.__row_id === row.__row_id),
      );
    }

    return filtered;
  }
}

function makeFakeTrx(seed: DbState): any {
  const state = cloneState(seed);

  const trx: any = (table: string) => new FakeQuery(state, normalizeTableName(table), () => 'NOW');
  trx.fn = { now: () => 'NOW' };
  trx.schema = { hasColumn: vi.fn(async () => true) };
  trx.commit = vi.fn(async () => undefined);
  trx.rollback = vi.fn(async () => undefined);
  trx.__state = state;

  return trx;
}

function cycleStarts(state: DbState): string[] {
  return state.client_billing_cycles
    .map((row) => String(row.period_start_date).slice(0, 10))
    .sort();
}

describe('billing history bootstrap cycle regeneration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T12:00:00Z'));
  });

  it('T019: saving schedule with optional history date and no cycles creates cycles from normalized boundary through present', async () => {
    const trx = makeFakeTrx({
      clients: [{ tenant: 'tenant-1', client_id: 'client-1', billing_cycle: 'monthly' }],
      client_billing_settings: [{ tenant: 'tenant-1', client_id: 'client-1' }],
      client_billing_cycles: [],
      invoices: [],
    });

    await updateClientBillingSchedule(trx, 'tenant-1', {
      clientId: 'client-1',
      billingCycle: 'monthly',
      anchor: { dayOfMonth: 1 },
      billingHistoryStartDate: '2025-12-15T00:00:00Z' as ISO8601String,
    });

    expect(cycleStarts(trx.__state)).toEqual([
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
  });

  it('T020: moving history earlier with only uninvoiced cycles deterministically regenerates contiguous historical cycles', async () => {
    const trx = makeFakeTrx({
      clients: [{ tenant: 'tenant-1', client_id: 'client-1', billing_cycle: 'monthly' }],
      client_billing_settings: [{ tenant: 'tenant-1', client_id: 'client-1' }],
      client_billing_cycles: [
        { tenant: 'tenant-1', client_id: 'client-1', billing_cycle_id: 'c1', period_start_date: '2026-01-01T00:00:00Z', period_end_date: '2026-02-01T00:00:00Z' },
        { tenant: 'tenant-1', client_id: 'client-1', billing_cycle_id: 'c2', period_start_date: '2026-02-01T00:00:00Z', period_end_date: '2026-03-01T00:00:00Z' },
        { tenant: 'tenant-1', client_id: 'client-1', billing_cycle_id: 'c3', period_start_date: '2026-03-01T00:00:00Z', period_end_date: '2026-04-01T00:00:00Z' },
      ],
      invoices: [],
    });

    await updateClientBillingSchedule(trx, 'tenant-1', {
      clientId: 'client-1',
      billingCycle: 'monthly',
      anchor: { dayOfMonth: 1 },
      billingHistoryStartDate: '2025-11-15T00:00:00Z' as ISO8601String,
    });

    expect(cycleStarts(trx.__state)).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);

    const sorted = [...trx.__state.client_billing_cycles].sort((a, b) =>
      String(a.period_start_date).localeCompare(String(b.period_start_date)),
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(String(sorted[i].period_end_date).slice(0, 10)).toBe(String(sorted[i + 1].period_start_date).slice(0, 10));
    }
  });

  it('T021: moving history earlier than earliest invoiced boundary is blocked and does not mutate cycles', async () => {
    const trx = makeFakeTrx({
      clients: [{ tenant: 'tenant-1', client_id: 'client-1', billing_cycle: 'monthly' }],
      client_billing_settings: [{ tenant: 'tenant-1', client_id: 'client-1' }],
      client_billing_cycles: [
        { tenant: 'tenant-1', client_id: 'client-1', billing_cycle_id: 'invoiced-1', period_start_date: '2026-01-01T00:00:00Z', period_end_date: '2026-02-01T00:00:00Z' },
        { tenant: 'tenant-1', client_id: 'client-1', billing_cycle_id: 'uninvoiced-2', period_start_date: '2026-02-01T00:00:00Z', period_end_date: '2026-03-01T00:00:00Z' },
      ],
      invoices: [
        { tenant: 'tenant-1', billing_cycle_id: 'invoiced-1', invoice_id: 'inv-1' },
      ],
    });

    const before = JSON.stringify(trx.__state.client_billing_cycles);

    await expect(updateClientBillingSchedule(trx, 'tenant-1', {
      clientId: 'client-1',
      billingCycle: 'monthly',
      anchor: { dayOfMonth: 1 },
      billingHistoryStartDate: '2025-12-15T00:00:00Z' as ISO8601String,
    })).rejects.toThrow('Cannot move billing history earlier than invoiced history boundary');

    expect(JSON.stringify(trx.__state.client_billing_cycles)).toBe(before);
  });

  it('preserves staged future uninvoiced cycles while backfilling history', async () => {
    const trx = makeFakeTrx({
      clients: [{ tenant: 'tenant-1', client_id: 'client-1', billing_cycle: 'monthly' }],
      client_billing_settings: [{ tenant: 'tenant-1', client_id: 'client-1' }],
      client_billing_cycles: [
        { tenant: 'tenant-1', client_id: 'client-1', billing_cycle_id: 'c2', period_start_date: '2026-02-01T00:00:00Z', period_end_date: '2026-03-01T00:00:00Z' },
        { tenant: 'tenant-1', client_id: 'client-1', billing_cycle_id: 'c3', period_start_date: '2026-03-01T00:00:00Z', period_end_date: '2026-04-01T00:00:00Z' },
        { tenant: 'tenant-1', client_id: 'client-1', billing_cycle_id: 'c4', period_start_date: '2026-04-01T00:00:00Z', period_end_date: '2026-05-01T00:00:00Z' },
        { tenant: 'tenant-1', client_id: 'client-1', billing_cycle_id: 'c5', period_start_date: '2026-05-01T00:00:00Z', period_end_date: '2026-06-01T00:00:00Z' },
      ],
      invoices: [],
    });

    await updateClientBillingSchedule(trx, 'tenant-1', {
      clientId: 'client-1',
      billingCycle: 'monthly',
      anchor: { dayOfMonth: 1 },
      billingHistoryStartDate: '2025-12-15T00:00:00Z' as ISO8601String,
    });

    expect(cycleStarts(trx.__state)).toEqual([
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
    ]);
  });
});
