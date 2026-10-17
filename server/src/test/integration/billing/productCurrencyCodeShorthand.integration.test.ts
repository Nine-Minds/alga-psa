import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { ProductCatalogService } from '@/lib/api/services/ProductCatalogService';
import { createProductSchema, updateProductSchema } from '@/lib/api/schemas/productSchemas';

/**
 * alga0002285: POST/PUT /api/v1/products with a top-level currency_code used to
 * 500 (42703: service_catalog has no currency_code column). `currency_code` +
 * `default_rate` is now shorthand for a single service_prices entry written
 * through the shared pricing writer. Drives the same schema -> service path the
 * controller runs, against the real database.
 */

let db: Knex;
let tenantId: string;
let nonUsdTenantId: string;
let userId: string;
let serviceTypeId: string;
let nonUsdServiceTypeId: string;

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, requireTenantId: vi.fn(async () => tenantId) };
});
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(async () => undefined), publishWorkflowEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));

const HOOK_TIMEOUT = 300_000;
const table = (name: string, tenant = tenantId) => tenantDb(db, tenant).table(name);

function productService(tenant = tenantId) {
  const service = new ProductCatalogService();
  vi.spyOn(service as unknown as { getKnex: () => Promise<unknown> }, 'getKnex').mockResolvedValue({ knex: db, tenant });
  return service;
}
const ctx = (tenant = tenantId) => ({ tenant, userId }) as never;

type Outcome = { status: number; body?: any; error?: any };

/** Mirrors the controller: schema parse (400), then the service call. */
async function post(body: unknown, tenant = tenantId, typeId = serviceTypeId): Promise<Outcome> {
  const parsed = createProductSchema.safeParse({ service_name: `Prod ${uuidv4().slice(0, 8)}`, custom_service_type_id: typeId, unit_of_measure: 'each', ...(body as object) });
  if (!parsed.success) return { status: 400, error: parsed.error };
  try {
    return { status: 200, body: await productService(tenant).create(parsed.data as never, ctx(tenant)) };
  } catch (error: any) {
    return { status: error.statusCode ?? 500, error };
  }
}
async function put(id: string, body: unknown): Promise<Outcome> {
  const parsed = updateProductSchema.safeParse(body);
  if (!parsed.success) return { status: 400, error: parsed.error };
  try {
    return { status: 200, body: await productService().update(id, parsed.data as never, ctx()) };
  } catch (error: any) {
    return { status: error.statusCode ?? 500, error };
  }
}

const priceRows = async (serviceId: string, tenant = tenantId) =>
  (await table('service_prices', tenant).where({ service_id: serviceId }).orderBy(['display_order', 'currency_code']))
    .map((r: any) => [r.currency_code, Number(r.rate), r.display_order]);
const defaultRateOf = async (serviceId: string, tenant = tenantId) =>
  Number((await table('service_catalog', tenant).where({ service_id: serviceId }).first('default_rate')).default_rate);

async function seedProduct(prices: Array<[string, number]>): Promise<string> {
  const serviceId = uuidv4();
  await table('service_catalog').insert({
    service_id: serviceId,
    tenant: tenantId,
    service_name: `Seed ${serviceId.slice(0, 8)}`,
    billing_method: 'usage',
    custom_service_type_id: serviceTypeId,
    default_rate: prices[0]?.[1] ?? 0,
    unit_of_measure: 'each',
    item_kind: 'product',
    is_active: true,
  });
  for (const [index, [currency_code, rate]] of prices.entries()) {
    await table('service_prices').insert({
      price_id: uuidv4(), tenant: tenantId, service_id: serviceId, currency_code, rate,
      effective_date: '1970-01-01', display_order: index,
    });
  }
  return serviceId;
}

describe('products REST API currency_code shorthand (alga0002285)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: process.env.TEST_DB_NAME_PRODUCT_CURRENCY ?? 'test_db_product_currency_code' });
    tenantId = uuidv4();
    nonUsdTenantId = uuidv4();
    for (const tenant of [tenantId, nonUsdTenantId]) {
      await tenantDb(db, tenant)
        .unscoped('tenants', 'test fixture creates tenant rows')
        .insert({
          tenant,
          client_name: `Product Currency ${tenant.slice(0, 8)}`,
          email: `product-currency-${tenant.slice(0, 8)}@example.test`,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        });
    }
    serviceTypeId = uuidv4();
    nonUsdServiceTypeId = uuidv4();
    await table('service_types').insert({ id: serviceTypeId, tenant: tenantId, name: 'Product currency type' });
    await table('service_types', nonUsdTenantId).insert({ id: nonUsdServiceTypeId, tenant: nonUsdTenantId, name: 'Non-USD type' });
    await table('default_billing_settings', nonUsdTenantId).insert({
      tenant: nonUsdTenantId,
      default_currency_code: 'EUR',
    });
    userId = uuidv4();
    setupCommonMocks({ tenantId, userId, permissionCheck: () => true });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('1. create with currency_code + default_rate: no 500, clean row, one price, default_rate mirrors it', async () => {
    const result = await post({ currency_code: 'GBP', default_rate: 4500 });
    expect(result.status).toBe(200);
    const id = result.body.service_id;
    const row = await table('service_catalog').where({ service_id: id }).first();
    expect(row).not.toHaveProperty('currency_code');
    expect(Number(row.default_rate)).toBe(4500);
    expect(await priceRows(id)).toEqual([['GBP', 4500, 0]]);
    expect(result.body.prices).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('2. create in a tenant whose default currency is not USD never assumes USD', async () => {
    const result = await post({ currency_code: 'JPY', default_rate: 1200 }, nonUsdTenantId, nonUsdServiceTypeId);
    expect(result.status).toBe(200);
    const id = result.body.service_id;
    expect(await priceRows(id, nonUsdTenantId)).toEqual([['JPY', 1200, 0]]);
    const row = await table('service_catalog', nonUsdTenantId).where({ service_id: id }).first();
    expect(row.cost_currency).toBe('EUR');
    expect((await table('service_prices', nonUsdTenantId).where({ service_id: id, currency_code: 'USD' })).length).toBe(0);
  }, HOOK_TIMEOUT);

  it('3. create with currency_code + prices is a 400', async () => {
    const result = await post({ currency_code: 'USD', default_rate: 100, prices: [{ currency_code: 'USD', rate: 100 }] });
    expect(result.status).toBe(400);
  }, HOOK_TIMEOUT);

  it.each([
    ['unsupported currency_code', { currency_code: 'XXX', default_rate: 100 }],
    ['lowercase currency_code', { currency_code: 'usd', default_rate: 100 }],
    ['currency_code without default_rate', { currency_code: 'USD' }],
    ['fractional default_rate with currency_code', { currency_code: 'USD', default_rate: 10.5 }],
  ])('4. create rejects %s with 400', async (_label, body) => {
    expect((await post(body)).status).toBe(400);
  }, HOOK_TIMEOUT);

  it('4b. the service layer also answers 400 (not 500) if the schema is bypassed', async () => {
    const service = productService();
    await expect(service.create({ service_name: 'x', custom_service_type_id: serviceTypeId, currency_code: 'USD' } as never, ctx()))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(service.create({ service_name: 'x', custom_service_type_id: serviceTypeId, currency_code: 'XXX', default_rate: 1 } as never, ctx()))
      .rejects.toMatchObject({ statusCode: 400 });
  }, HOOK_TIMEOUT);

  it('5. update with currency_code + default_rate changes that currency, makes it primary, keeps the other', async () => {
    const id = await seedProduct([['USD', 1000], ['EUR', 900]]);
    const result = await put(id, { currency_code: 'EUR', default_rate: 950 });
    expect(result.status).toBe(200);
    expect(await priceRows(id)).toEqual([['EUR', 950, 0], ['USD', 1000, 1]]);
    expect(await defaultRateOf(id)).toBe(950);
    expect(result.body.prices.map((p: any) => [p.currency_code, Number(p.rate)])).toEqual([['EUR', 950], ['USD', 1000]]);
  }, HOOK_TIMEOUT);

  it('6. update with currency_code for a new currency adds it as primary and keeps existing prices', async () => {
    const id = await seedProduct([['USD', 1000], ['EUR', 900]]);
    expect((await put(id, { currency_code: 'GBP', default_rate: 800 })).status).toBe(200);
    expect(await priceRows(id)).toEqual([['GBP', 800, 0], ['USD', 1000, 1], ['EUR', 900, 2]]);
    expect(await defaultRateOf(id)).toBe(800);
  }, HOOK_TIMEOUT);

  it('6b. update shorthand on a product with no price rows creates one and leaves scheduled prices alone', async () => {
    const id = await seedProduct([['USD', 1000]]);
    const future = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 1)).toISOString().slice(0, 10);
    expect((await put(id, { scheduled_prices: [{ currency_code: 'USD', rate: 1500, effective_date: future }] })).status).toBe(200);
    expect((await put(id, { currency_code: 'USD', default_rate: 1100 })).status).toBe(200);
    const read = await productService().getById(id, ctx());
    expect(read!.prices!.map((p: any) => [p.currency_code, Number(p.rate)])).toEqual([['USD', 1100]]);
    expect(read!.scheduled_prices).toHaveLength(1);
    const empty = await seedProduct([]);
    expect((await put(empty, { currency_code: 'CAD', default_rate: 77 })).status).toBe(200);
    expect(await priceRows(empty)).toEqual([['CAD', 77, 0]]);
  }, HOOK_TIMEOUT);

  it('7. update with currency_code but no default_rate is a 400 and writes nothing', async () => {
    const id = await seedProduct([['USD', 1000], ['EUR', 900]]);
    const result = await put(id, { currency_code: 'EUR', description: 'changed' });
    expect(result.status).toBe(400);
    expect(await priceRows(id)).toEqual([['USD', 1000, 0], ['EUR', 900, 1]]);
    // Schema bypassed: still a 400 from the service, never a 500.
    await expect(productService().update(id, { currency_code: 'EUR' } as never, ctx())).rejects.toMatchObject({ statusCode: 400 });
  }, HOOK_TIMEOUT);

  it('7b. update with an unsupported currency_code or currency_code + prices is a 400', async () => {
    const id = await seedProduct([['USD', 1000]]);
    expect((await put(id, { currency_code: 'XXX', default_rate: 5 })).status).toBe(400);
    expect((await put(id, { currency_code: 'USD', default_rate: 5, prices: [{ currency_code: 'USD', rate: 5 }] })).status).toBe(400);
    expect(await priceRows(id)).toEqual([['USD', 1000, 0]]);
  }, HOOK_TIMEOUT);

  it('8. regression: create and update with only prices[] still work', async () => {
    const created = await post({ prices: [{ currency_code: 'EUR', rate: 300 }, { currency_code: 'USD', rate: 400 }] });
    expect(created.status).toBe(200);
    const id = created.body.service_id;
    expect(await priceRows(id)).toEqual([['EUR', 300, 0], ['USD', 400, 1]]);
    expect(await defaultRateOf(id)).toBe(300);
    expect((await put(id, { prices: [{ currency_code: 'USD', rate: 450 }] })).status).toBe(200);
    expect(await priceRows(id)).toEqual([['USD', 450, 0]]);
    expect(await defaultRateOf(id)).toBe(450);
  }, HOOK_TIMEOUT);

  it('8b. regression: create with neither default_rate nor prices still creates a 0-rate product', async () => {
    const result = await post({});
    expect(result.status).toBe(200);
    expect(await defaultRateOf(result.body.service_id)).toBe(0);
  }, HOOK_TIMEOUT);
});
