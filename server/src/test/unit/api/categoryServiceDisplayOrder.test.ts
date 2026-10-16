// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(async (knex: unknown, callback: (trx: unknown) => unknown) => callback(knex)),
  tenantDb: vi.fn(),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, withTransaction: mocks.withTransaction, tenantDb: mocks.tenantDb };
});

import { CategoryService } from '../../../lib/api/services/CategoryService';
import {
  createServiceCategorySchema,
  serviceCategoryResponseSchema,
  updateServiceCategorySchema,
} from '../../../lib/api/schemas/categorySchemas';

const TENANT = 'tenant-1';
const USER = 'user-1';
const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const context = { tenant: TENANT, userId: USER } as any;

/** Records what the service does against `service_categories`. */
function installFakeDb(options: { currentMax: number | null }) {
  const calls = {
    tenantDbTenants: [] as string[],
    tables: [] as string[],
    maxColumns: [] as string[],
    inserted: undefined as Record<string, any> | undefined,
    updated: undefined as Record<string, any> | undefined,
  };

  mocks.tenantDb.mockImplementation((_trx: unknown, tenant: string) => {
    calls.tenantDbTenants.push(tenant);
    return {
      table: (name: string) => {
        calls.tables.push(name);
        const query: any = {
          max: (column: string) => {
            calls.maxColumns.push(column);
            return { first: async () => ({ max: options.currentMax }) };
          },
          insert: (row: Record<string, any>) => {
            calls.inserted = row;
            return { returning: async () => [{ ...row }] };
          },
          where: () => query,
          update: (row: Record<string, any>) => {
            calls.updated = row;
            return { returning: async () => [{ category_id: CATEGORY_ID, ...row }] };
          },
        };
        return query;
      },
    };
  });

  return calls;
}

function makeService() {
  const service = new CategoryService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
  return service;
}

describe('service category display_order (schemas)', () => {
  it('create schema keeps display_order', () => {
    const parsed = createServiceCategorySchema.parse({ category_name: 'Hardware', display_order: 7 });
    expect(parsed.display_order).toBe(7);
  });

  it('create schema keeps an explicit 0', () => {
    expect(createServiceCategorySchema.parse({ category_name: 'Hardware', display_order: 0 }).display_order).toBe(0);
  });

  it('create schema leaves display_order undefined when omitted', () => {
    expect(createServiceCategorySchema.parse({ category_name: 'Hardware' }).display_order).toBeUndefined();
  });

  it('create schema rejects negative display_order', () => {
    expect(createServiceCategorySchema.safeParse({ category_name: 'Hardware', display_order: -1 }).success).toBe(false);
  });

  it('create schema rejects non-integer display_order', () => {
    expect(createServiceCategorySchema.safeParse({ category_name: 'Hardware', display_order: 1.5 }).success).toBe(false);
    expect(createServiceCategorySchema.safeParse({ category_name: 'Hardware', display_order: '3' }).success).toBe(false);
  });

  it('update schema keeps display_order', () => {
    expect(updateServiceCategorySchema.parse({ display_order: 4 }).display_order).toBe(4);
    expect(updateServiceCategorySchema.safeParse({ display_order: -2 }).success).toBe(false);
  });

  it('response schema includes display_order', () => {
    expect(Object.keys(serviceCategoryResponseSchema.shape)).toContain('display_order');
  });
});

describe('CategoryService service category display_order (persistence)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes the given display_order on create without querying the max', async () => {
    const calls = installFakeDb({ currentMax: 10 });
    const created = await makeService().createServiceCategory(
      { category_name: 'Hardware', display_order: 5 } as any,
      context
    );

    expect(calls.inserted?.display_order).toBe(5);
    expect(created.display_order).toBe(5);
    expect(calls.maxColumns).toEqual([]);
  });

  it('honors an explicit 0 literally on create', async () => {
    const calls = installFakeDb({ currentMax: 10 });
    await makeService().createServiceCategory({ category_name: 'Hardware', display_order: 0 } as any, context);

    expect(calls.inserted?.display_order).toBe(0);
    expect(calls.maxColumns).toEqual([]);
  });

  it('appends at max + 1, tenant scoped, when display_order is omitted on create', async () => {
    const calls = installFakeDb({ currentMax: 4 });
    await makeService().createServiceCategory({ category_name: 'Hardware' } as any, context);

    expect(calls.maxColumns).toEqual(['display_order as max']);
    expect(calls.inserted?.display_order).toBe(5);
    expect(calls.inserted?.tenant).toBe(TENANT);
    expect(calls.tenantDbTenants.length).toBeGreaterThan(0);
    expect(new Set(calls.tenantDbTenants)).toEqual(new Set([TENANT]));
    expect(new Set(calls.tables)).toEqual(new Set(['service_categories']));
  });

  it('appends at max + 1 when max is returned as a string (pg numeric/bigint)', async () => {
    const calls = installFakeDb({ currentMax: '9' as any });
    await makeService().createServiceCategory({ category_name: 'Hardware' } as any, context);

    expect(calls.inserted?.display_order).toBe(10);
  });

  it('starts at 1 for a tenant with no service categories (matches the UI action)', async () => {
    const calls = installFakeDb({ currentMax: null });
    await makeService().createServiceCategory({ category_name: 'Hardware' } as any, context);

    expect(calls.inserted?.display_order).toBe(1);
  });

  it('writes display_order on update when present (including 0)', async () => {
    const calls = installFakeDb({ currentMax: null });
    const service = makeService();

    const updated = await service.updateServiceCategory(CATEGORY_ID, { display_order: 3 }, context);
    expect(calls.updated?.display_order).toBe(3);
    expect(updated.display_order).toBe(3);

    await service.updateServiceCategory(CATEGORY_ID, { display_order: 0 }, context);
    expect(calls.updated?.display_order).toBe(0);
  });

  it('leaves display_order alone on update when absent', async () => {
    const calls = installFakeDb({ currentMax: null });
    await makeService().updateServiceCategory(CATEGORY_ID, { category_name: 'Renamed' }, context);

    expect(calls.updated).toBeDefined();
    expect(calls.updated).not.toHaveProperty('display_order');
    expect(calls.maxColumns).toEqual([]);
  });
});
