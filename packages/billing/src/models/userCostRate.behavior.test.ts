import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const store = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
}));

function normalizeTableName(tableName: string) {
  return tableName.split(/\s+as\s+/i)[0].trim();
}

function normalizeColumnName(columnName: string) {
  const [, unqualifiedName] = columnName.match(/^(?:[^.]+)\.(.+)$/) ?? [];
  return unqualifiedName ?? columnName;
}

function rawDateValue(value: unknown) {
  if (value && typeof value === 'object' && 'kind' in value && (value as { kind: string }).kind === 'raw') {
    return (value as unknown as { value: string | null }).value ?? 'infinity';
  }

  return value;
}

function compareValues(left: unknown, operator: string, right: unknown) {
  const normalizedRight = rawDateValue(right);
  if (operator === '=') return left === normalizedRight;
  if (operator === '<=') return String(left) <= String(normalizedRight);
  if (operator === '>=') return String(left) >= String(normalizedRight);
  if (operator === '<>') return left !== normalizedRight;
  throw new Error(`Unsupported operator ${operator}`);
}

class OrGroup {
  private predicates: Array<(row: Row) => boolean> = [];

  where(column: string, value: unknown) {
    this.predicates.push((row) => row[normalizeColumnName(column)] === value);
    return this;
  }

  orWhere(column: string, operatorOrValue: unknown, maybeValue?: unknown) {
    const operator = maybeValue === undefined ? '=' : String(operatorOrValue);
    const value = maybeValue === undefined ? operatorOrValue : maybeValue;
    this.predicates.push((row) => compareValues(row[normalizeColumnName(column)], operator, value));
    return this;
  }

  orWhereNull(column: string) {
    this.predicates.push((row) => row[normalizeColumnName(column)] == null);
    return this;
  }

  whereNull(column: string) {
    return this.orWhereNull(column);
  }

  matches(row: Row) {
    return this.predicates.some((predicate) => predicate(row));
  }
}

class MockQuery {
  private predicates: Array<(row: Row) => boolean> = [];
  private sorters: Array<(left: Row, right: Row) => number> = [];

  constructor(
    private readonly tenant: string,
    private readonly tableName: string,
  ) {}

  private rows() {
    store.tables[this.tableName] ??= [];
    return store.tables[this.tableName];
  }

  private filteredRows() {
    return this.rows()
      .filter((row) => row.tenant === this.tenant)
      .filter((row) => this.predicates.every((predicate) => predicate(row)))
      .sort((left, right) => {
        for (const sorter of this.sorters) {
          const result = sorter(left, right);
          if (result !== 0) return result;
        }
        return 0;
      });
  }

  select() {
    return this;
  }

  where(criteria: Record<string, unknown> | string | ((this: OrGroup, builder: OrGroup) => void), operatorOrValue?: unknown, maybeValue?: unknown) {
    if (typeof criteria === 'function') {
      const group = new OrGroup();
      criteria.call(group, group);
      this.predicates.push((row) => group.matches(row));
      return this;
    }

    if (typeof criteria === 'string') {
      const operator = maybeValue === undefined ? '=' : String(operatorOrValue);
      const value = maybeValue === undefined ? operatorOrValue : maybeValue;
      this.predicates.push((row) => compareValues(row[normalizeColumnName(criteria)], operator, value));
      return this;
    }

    this.predicates.push((row) => (
      Object.entries(criteria).every(([column, expected]) => row[normalizeColumnName(column)] === expected)
    ));
    return this;
  }

  andWhere(criteria: Record<string, unknown> | string | ((this: OrGroup, builder: OrGroup) => void), operatorOrValue?: unknown, maybeValue?: unknown) {
    return this.where(criteria as any, operatorOrValue, maybeValue);
  }

  whereNull(column: string) {
    this.predicates.push((row) => row[normalizeColumnName(column)] == null);
    return this;
  }

  orWhereNull(column: string) {
    return this.whereNull(column);
  }

  andWhereRaw(sql: string, bindings: unknown[]) {
    if (sql.includes("COALESCE(effective_to, 'infinity'::date)")) {
      const effectiveFrom = String(bindings[0]);
      this.predicates.push((row) => effectiveFrom <= String(row.effective_to ?? 'infinity'));
      return this;
    }

    throw new Error(`Unsupported raw predicate: ${sql}`);
  }

  orderBy(columnOrSpecs: string | Array<{ column: string; order?: string }>, direction = 'asc') {
    const specs = Array.isArray(columnOrSpecs) ? columnOrSpecs : [{ column: columnOrSpecs, order: direction }];
    for (const spec of specs) {
      const column = normalizeColumnName(spec.column);
      const multiplier = spec.order === 'desc' ? -1 : 1;
      this.sorters.push((left, right) => String(left[column] ?? '').localeCompare(String(right[column] ?? '')) * multiplier);
    }
    return this;
  }

  orderByRaw(sql: string) {
    if (sql === 'ucr.user_id IS NULL') {
      this.sorters.push((left, right) => Number(left.user_id == null) - Number(right.user_id == null));
      return this;
    }

    throw new Error(`Unsupported orderByRaw: ${sql}`);
  }

  first() {
    return Promise.resolve(this.filteredRows()[0] ?? null);
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.filteredRows()).then(onfulfilled, onrejected);
  }

  insert(payload: Row) {
    this.rows().push({ ...payload });
    return {
      returning: async () => [{ ...payload }],
    };
  }

  update(payload: Row) {
    const rows = this.filteredRows();
    for (const row of rows) {
      Object.assign(row, payload);
    }
    return {
      returning: async () => rows.map((row) => ({ ...row })),
    };
  }

  async delete() {
    const rowsToDelete = new Set(this.filteredRows());
    store.tables[this.tableName] = this.rows().filter((row) => !rowsToDelete.has(row));
    return rowsToDelete.size;
  }
}

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_knexOrTrx: unknown, tenant: string) => ({
    table: (tableName: string) => new MockQuery(tenant, normalizeTableName(tableName)),
  }),
  withTransaction: async (_knex: unknown, callback: (trx: any) => Promise<unknown>) => callback({
    raw: vi.fn((_sql: string, bindings: unknown[]) => ({ kind: 'raw', value: bindings[0] })),
    fn: { now: () => 'now()' },
  }),
}));

import UserCostRate, { CostRateValidationError } from './userCostRate';

function seed() {
  store.tables = {
    users: [
      { tenant: 'tenant-1', user_id: 'user-1', user_type: 'internal' },
      { tenant: 'tenant-1', user_id: 'user-2', user_type: 'internal' },
      { tenant: 'tenant-2', user_id: 'user-1', user_type: 'internal' },
    ],
    user_cost_rates: [],
  };
}

describe('UserCostRate model behavior', () => {
  beforeEach(() => {
    seed();
  });

  it('round-trips insert/list/update/delete and remains tenant-scoped', async () => {
    const inserted = await UserCostRate.upsert({} as any, 'tenant-1', {
      user_id: 'user-1',
      cost_rate: 5000,
      effective_from: '2026-01-01',
      effective_to: '2026-03-31',
      created_by: 'admin-1',
    });
    await UserCostRate.upsert({} as any, 'tenant-2', {
      user_id: 'user-1',
      cost_rate: 9000,
      effective_from: '2026-01-01',
    });

    expect(await UserCostRate.listByUser({} as any, 'tenant-1', 'user-1')).toHaveLength(1);
    expect(await UserCostRate.list({} as any, 'tenant-1')).toEqual([
      expect.objectContaining({ rate_id: inserted.rate_id, tenant: 'tenant-1', cost_rate: 5000 }),
    ]);

    const updated = await UserCostRate.upsert({} as any, 'tenant-1', {
      rate_id: inserted.rate_id,
      user_id: 'user-1',
      cost_rate: 6250,
      effective_from: '2026-01-01',
      effective_to: '2026-03-31',
    });
    expect(updated.cost_rate).toBe(6250);

    const deleted = await UserCostRate.delete({} as any, 'tenant-1', inserted.rate_id);
    expect(deleted.rate_id).toBe(inserted.rate_id);
    expect(await UserCostRate.list({} as any, 'tenant-1')).toEqual([]);
    expect(await UserCostRate.list({} as any, 'tenant-2')).toHaveLength(1);
  });

  it('rejects a closed-range overlap for the same user', async () => {
    await UserCostRate.upsert({} as any, 'tenant-1', {
      user_id: 'user-1',
      cost_rate: 5000,
      effective_from: '2026-01-01',
      effective_to: '2026-03-31',
    });

    await expect(UserCostRate.upsert({} as any, 'tenant-1', {
      user_id: 'user-1',
      cost_rate: 6000,
      effective_from: '2026-03-15',
      effective_to: '2026-04-30',
    })).rejects.toMatchObject({ code: 'overlap' });
  });

  it('rejects overlap against an open-ended range', async () => {
    await UserCostRate.upsert({} as any, 'tenant-1', {
      user_id: 'user-1',
      cost_rate: 5000,
      effective_from: '2026-01-01',
    });

    await expect(UserCostRate.upsert({} as any, 'tenant-1', {
      user_id: 'user-1',
      cost_rate: 6000,
      effective_from: '2026-04-01',
      effective_to: '2026-04-30',
    })).rejects.toBeInstanceOf(CostRateValidationError);
  });

  it('allows adjacent ranges for one user', async () => {
    await UserCostRate.upsert({} as any, 'tenant-1', {
      user_id: 'user-1',
      cost_rate: 5000,
      effective_from: '2026-01-01',
      effective_to: '2026-03-31',
    });

    const adjacent = await UserCostRate.upsert({} as any, 'tenant-1', {
      user_id: 'user-1',
      cost_rate: 6000,
      effective_from: '2026-04-01',
    });

    expect(adjacent.cost_rate).toBe(6000);
    expect(await UserCostRate.listByUser({} as any, 'tenant-1', 'user-1')).toHaveLength(2);
  });

  it('scopes overlap validation by user and tenant default', async () => {
    await UserCostRate.upsert({} as any, 'tenant-1', {
      user_id: 'user-1',
      cost_rate: 5000,
      effective_from: '2026-01-01',
      effective_to: '2026-03-31',
    });

    await expect(UserCostRate.upsert({} as any, 'tenant-1', {
      user_id: 'user-2',
      cost_rate: 6000,
      effective_from: '2026-01-01',
      effective_to: '2026-03-31',
    })).resolves.toMatchObject({ user_id: 'user-2' });

    await expect(UserCostRate.upsert({} as any, 'tenant-1', {
      user_id: null,
      cost_rate: 4000,
      effective_from: '2026-01-01',
      effective_to: '2026-03-31',
    })).resolves.toMatchObject({ user_id: null });
  });

  it('returns null when no user or tenant-default rate covers the work date', async () => {
    await UserCostRate.upsert({} as any, 'tenant-1', {
      user_id: 'user-1',
      cost_rate: 5000,
      effective_from: '2026-01-01',
      effective_to: '2026-01-31',
    });

    await expect(UserCostRate.resolveCostRate({} as any, 'tenant-1', 'user-1', '2026-02-01')).resolves.toBeNull();
  });
});
