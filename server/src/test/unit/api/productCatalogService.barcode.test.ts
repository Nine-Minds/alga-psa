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
import {
  createProductSchema,
  updateProductSchema,
} from '../../../lib/api/schemas/productSchemas';

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

describe('ProductCatalogService barcode behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishServiceCatalogSearchEvent.mockResolvedValue(undefined);
  });

  it('REST schemas preserve barcode input', () => {
    const createPayload = createProductSchema.parse({
      service_name: 'Managed Router',
      custom_service_type_id: '11111111-1111-4111-8111-111111111111',
      unit_of_measure: 'each',
      barcode: '036000291452',
    });
    const updatePayload = updateProductSchema.parse({ barcode: '036000291452' });

    expect(createPayload.barcode).toBe('036000291452');
    expect(updatePayload.barcode).toBe('036000291452');
  });

  it('creates and returns a product with a normalized barcode', async () => {
    let inserted: Record<string, unknown> | undefined;
    const table = vi.fn((tableName: string) => {
      expect(tableName).toBe('service_catalog');
      return {
        insert: vi.fn((data: Record<string, unknown>) => {
          inserted = data;
          return {
            returning: vi.fn(async () => [{ ...data, service_id: 'product-1' }]),
          };
        }),
      };
    });
    mocks.tenantDb.mockReturnValue({ table });

    const service = new ProductCatalogService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
    vi.spyOn(service, 'getById').mockImplementation(async () => ({
      ...(inserted as any),
      service_id: 'product-1',
    }));

    const result = await service.create({
      service_name: 'Managed Router',
      barcode: ' 036000291452 ',
      cost_currency: 'USD',
    }, context);

    expect(inserted).toMatchObject({
      barcode: '0036000291452',
      billing_method: 'usage',
      item_kind: 'product',
    });
    expect(result.barcode).toBe('0036000291452');
  });

  it('updates and returns a product with a normalized barcode', async () => {
    let updated: Record<string, unknown> | undefined;
    const query: any = {
      where: vi.fn(),
      select: vi.fn(),
      first: vi.fn(async () => ({ item_kind: 'product' })),
      update: vi.fn(async (data: Record<string, unknown>) => {
        updated = data;
        return 1;
      }),
    };
    query.where.mockReturnValue(query);
    query.select.mockReturnValue(query);
    mocks.tenantDb.mockReturnValue({ table: vi.fn(() => query) });

    const service = new ProductCatalogService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
    vi.spyOn(service, 'getById').mockImplementation(async () => ({
      ...(updated as any),
      service_id: 'product-1',
    }));

    const result = await service.update(
      'product-1',
      { barcode: '036000291452' },
      context,
    );

    expect(updated).toMatchObject({
      barcode: '0036000291452',
      billing_method: 'usage',
      item_kind: 'product',
    });
    expect(result.barcode).toBe('0036000291452');

    const cleared = await service.update(
      'product-1',
      { barcode: '   ' },
      context,
    );

    expect(updated?.barcode).toBeNull();
    expect(cleared.barcode).toBeNull();
  });

  it('searches barcode with normalized scanner input and includes it in list results', async () => {
    const searches: Array<{ column: string; value: string }> = [];
    const product = {
      service_id: 'product-1',
      service_name: 'Managed Router',
      barcode: '0036000291452',
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
      { filters: { search: '036000291452' } },
      context,
    );

    expect(searches).toContainEqual({
      column: 'sc.barcode',
      value: '%0036000291452%',
    });
    expect(result).toMatchObject({
      total: 1,
      data: [{ service_id: 'product-1', barcode: '0036000291452' }],
    });
  });

  it('maps duplicate barcode writes to a clear conflict', async () => {
    const duplicate = {
      code: '23505',
      constraint: 'service_catalog_product_barcode_unique',
    };
    mocks.tenantDb.mockReturnValue({
      table: vi.fn(() => ({
        insert: vi.fn(() => ({
          returning: vi.fn().mockRejectedValue(duplicate),
        })),
      })),
    });

    const service = new ProductCatalogService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });

    await expect(service.create({
      service_name: 'Duplicate Router',
      barcode: '036000291452',
      cost_currency: 'USD',
    }, context)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('barcode already exists'),
    });
  });
});
