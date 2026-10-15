import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tenantDb: vi.fn(),
  publishServiceCatalogSearchEvent: vi.fn(),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    tenantDb: mocks.tenantDb,
  };
});

vi.mock('../../../lib/api/services/ServiceCatalogService', () => ({
  publishServiceCatalogSearchEvent: mocks.publishServiceCatalogSearchEvent,
}));

import { ProductCatalogService } from '../../../lib/api/services/ProductCatalogService';

const context = {
  tenant: 'tenant-1',
  userId: 'user-1',
  user: {},
  db: {} as any,
};

class ListQuery {
  private countMode = false;

  constructor(
    private readonly rows: Array<Record<string, unknown>>,
    private readonly searches: Array<{ column: string; value: string }>,
  ) {}

  clone() {
    return new ListQuery(this.rows, this.searches);
  }

  where() { return this; }
  whereNull() { return this; }
  select() { return this; }
  orderBy() { return this; }
  limit() { return this; }
  offset() { return this; }
  whereIn() { return this; }

  andWhere(callback: (query: ListQuery) => void) {
    callback(this);
    return this;
  }

  whereILike(column: string, value: string) {
    this.searches.push({ column, value });
    return this;
  }

  orWhereILike(column: string, value: string) {
    this.searches.push({ column, value });
    return this;
  }

  count() {
    this.countMode = true;
    return this;
  }

  first() {
    return Promise.resolve(
      this.countMode ? { count: String(this.rows.length) } : this.rows[0],
    );
  }

  modify(callback: (query: ListQuery) => void) {
    callback(this);
    return this;
  }

  then<TResult1 = Array<Record<string, unknown>>, TResult2 = never>(
    onfulfilled?: ((value: Array<Record<string, unknown>>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

describe('ProductCatalogService label (product_category) behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishServiceCatalogSearchEvent.mockResolvedValue(undefined);
  });

  it('searches product_category with the plain term and returns the matched label', async () => {
    const searches: Array<{ column: string; value: string }> = [];
    const product = {
      service_id: 'product-1',
      service_name: 'Grandstream IP Phone',
      product_category: 'Grandstream GRP2614',
      item_kind: 'product',
    };
    const facade = {
      table: vi.fn((tableName: string) => new ListQuery(
        tableName === 'service_catalog as sc' ? [product] : [],
        searches,
      )),
      tenantJoin: vi.fn((query: ListQuery) => query),
    };
    mocks.tenantDb.mockReturnValue(facade);

    const service = new ProductCatalogService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({
      knex: { raw: vi.fn((sql: string) => sql) },
    });

    const result = await service.list(
      { filters: { search: 'GRP2614' } },
      context,
    );

    expect(searches).toContainEqual({
      column: 'sc.product_category',
      value: '%GRP2614%',
    });
    expect(result).toMatchObject({
      total: 1,
      data: [{ service_id: 'product-1', product_category: 'Grandstream GRP2614' }],
    });
  });
});
