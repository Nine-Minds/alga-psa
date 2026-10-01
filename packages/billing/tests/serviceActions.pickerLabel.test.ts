import { beforeEach, describe, expect, it, vi } from 'vitest';

type Search = { column: string; value: string };

class PickerQuery {
  private countMode = false;

  constructor(
    private readonly state: {
      rows: Array<Record<string, unknown>>;
      searches: Search[];
      selected: string[];
    },
  ) {}

  clone() {
    return new PickerQuery(this.state);
  }

  andWhere(columnOrCallback: string | ((query: PickerQuery) => void), _value?: unknown) {
    if (typeof columnOrCallback === 'function') columnOrCallback(this);
    return this;
  }

  whereIn() { return this; }

  whereILike(column: string, value: string) {
    this.state.searches.push({ column, value });
    return this;
  }

  orWhereILike(column: string, value: string) {
    this.state.searches.push({ column, value });
    return this;
  }

  count() {
    this.countMode = true;
    return this;
  }

  first() {
    return Promise.resolve(
      this.countMode ? { count: String(this.state.rows.length) } : this.state.rows[0],
    );
  }

  select(...args: unknown[]) {
    for (const arg of args) {
      if (typeof arg === 'string') this.state.selected.push(arg);
    }
    return this;
  }

  orderBy() { return this; }
  limit() { return this; }
  offset() { return this; }

  then<TResult1 = Array<Record<string, unknown>>, TResult2 = never>(
    onfulfilled?: ((value: Array<Record<string, unknown>>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.state.rows).then(onfulfilled, onrejected);
  }
}

const createTenantKnex = vi.fn();
let currentTrx: unknown;
let currentState: {
  rows: Array<Record<string, unknown>>;
  searches: Search[];
  selected: string[];
};

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnex(...args),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => unknown) => fn(currentTrx),
  tenantDb: () => ({
    table: () => new PickerQuery(currentState),
    tenantJoin: (query: unknown) => query,
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: (...args: any[]) => unknown) =>
    (...args: any[]) =>
      fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

describe('searchServiceCatalogForPicker label (product_category)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentState = {
      rows: [
        {
          service_id: 'product-1',
          service_name: 'Grandstream IP Phone',
          product_category: 'Grandstream GRP2614',
          sku: 'RTR-1',
          item_kind: 'product',
        },
      ],
      searches: [],
      selected: [],
    };
    currentTrx = { raw: (sql: string) => sql };
    createTenantKnex.mockResolvedValue({ knex: {} });
  });

  it('adds sc.product_category to the picker predicate and returns the field', async () => {
    const { searchServiceCatalogForPicker } = await import('../src/actions/serviceActions');

    const result = await searchServiceCatalogForPicker({
      search: 'GRP2614',
      item_kinds: ['product'],
      is_active: true,
    });

    expect(currentState.searches).toContainEqual({
      column: 'sc.product_category',
      value: '%GRP2614%',
    });
    expect(currentState.selected).toContain('sc.product_category as product_category');
    expect(result.items[0]?.product_category).toBe('Grandstream GRP2614');
  });
});
