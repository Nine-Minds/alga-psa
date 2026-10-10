import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { ServiceCatalogService } from '@/lib/api/services/ServiceCatalogService';
import { ProductCatalogService } from '@/lib/api/services/ProductCatalogService';
import { createServiceSchema, updateServiceSchema } from '@/lib/api/schemas/serviceSchemas';
import { updateProductSchema } from '@/lib/api/schemas/productSchemas';

/**
 * alga0002016: the REST API must be able to fully manage the price the Service
 * Catalog displays. These drive the same schema -> service path the controller
 * runs (zod parse, then ServiceCatalogService / ProductCatalogService) against
 * the real database.
 */

let db: Knex;
let tenantId: string;
let otherTenantId: string;
let userId: string;
let serviceTypeId: string;

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, requireTenantId: vi.fn(async () => tenantId) };
});
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(async () => undefined) }));

const HOOK_TIMEOUT = 300_000;
const FUTURE = (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1)).toISOString().slice(0, 10);
})();
const PAST = '2020-01-01';

const table = (name: string, tenant = tenantId) => tenantDb(db, tenant).table(name);

function serviceFor<T>(Ctor: new () => T, tenant = tenantId): T {
  const service = new Ctor();
  vi.spyOn(service as { getKnex: () => Promise<unknown> }, 'getKnex').mockResolvedValue({ knex: db, tenant });
  return service;
}
const ctx = (tenant = tenantId) => ({ tenant, userId }) as never;

type Outcome = { status: number; body?: any; error?: unknown };

/** Mirrors the controller: schema parse (400), then the service call. */
async function put(id: string, body: unknown, tenant = tenantId): Promise<Outcome> {
  const parsed = updateServiceSchema.safeParse(body);
  if (!parsed.success) return { status: 400, error: parsed.error };
  try {
    return { status: 200, body: await serviceFor(ServiceCatalogService, tenant).update(id, parsed.data as never, ctx(tenant)) };
  } catch (error: any) {
    return { status: error.statusCode ?? 500, error };
  }
}
async function post(body: unknown): Promise<Outcome> {
  const parsed = createServiceSchema.safeParse(body);
  if (!parsed.success) return { status: 400, error: parsed.error };
  try {
    return { status: 200, body: await serviceFor(ServiceCatalogService).create(parsed.data as never, ctx()) };
  } catch (error: any) {
    return { status: error.statusCode ?? 500, error };
  }
}
const get = (id: string) => serviceFor(ServiceCatalogService).getById(id, ctx());

async function seedService(opts: {
  defaultRate?: number;
  prices?: Array<{ currency_code: string; rate: number; effective_date?: string; display_order?: number }>;
  itemKind?: 'service' | 'product';
  tenant?: string;
  sku?: string;
} = {}): Promise<string> {
  const tenant = opts.tenant ?? tenantId;
  const serviceId = uuidv4();
  const kind = opts.itemKind ?? 'service';
  await table('service_catalog', tenant).insert({
    service_id: serviceId,
    tenant,
    service_name: `Svc ${serviceId.slice(0, 8)}`,
    billing_method: kind === 'product' ? 'usage' : 'fixed',
    custom_service_type_id: serviceTypeId,
    default_rate: opts.defaultRate ?? 10000,
    unit_of_measure: 'each',
    item_kind: kind,
    is_active: true,
    ...(opts.sku ? { sku: opts.sku } : {}),
  });
  for (const price of opts.prices ?? []) {
    await table('service_prices', tenant).insert({
      price_id: uuidv4(),
      tenant,
      service_id: serviceId,
      currency_code: price.currency_code,
      rate: price.rate,
      effective_date: price.effective_date ?? '1970-01-01',
      display_order: price.display_order ?? 0,
    });
  }
  return serviceId;
}

const rows = (serviceId: string, tenant = tenantId) =>
  table('service_prices', tenant).where({ service_id: serviceId }).orderBy(['effective_date', 'display_order', 'currency_code']);
const defaultRateOf = async (serviceId: string) =>
  Number((await table('service_catalog').where({ service_id: serviceId }).first('default_rate')).default_rate);
const snapshot = async (serviceId: string) => ({
  rows: (await rows(serviceId)).map((r: any) => [r.currency_code, Number(r.rate), String(r.effective_date), r.display_order]),
  defaultRate: await defaultRateOf(serviceId),
});

describe('services REST API price writes (alga0002016)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: process.env.TEST_DB_NAME_PRICE_WRITES ?? 'test_db_catalog_price_writes' });
    tenantId = uuidv4();
    otherTenantId = uuidv4();
    for (const tenant of [tenantId, otherTenantId]) {
      await tenantDb(db, tenant)
        .unscoped('tenants', 'test fixture creates tenant rows')
        .insert({
          tenant,
          client_name: `Price Writes ${tenant.slice(0, 8)}`,
          email: `price-writes-${tenant.slice(0, 8)}@example.test`,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        });
    }
    serviceTypeId = uuidv4();
    await table('service_types').insert({ id: serviceTypeId, tenant: tenantId, name: 'Price writes type' });
    await table('service_types', otherTenantId).insert({ id: uuidv4(), tenant: otherTenantId, name: 'Other type' });
    userId = uuidv4();
    setupCommonMocks({ tenantId, userId, permissionCheck: () => true });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('1. PUT prices replaces the row, syncs default_rate, and GET shows it as prices[0]', async () => {
    const id = await seedService({ defaultRate: 10000, prices: [{ currency_code: 'USD', rate: 10000 }] });
    const result = await put(id, { prices: [{ currency_code: 'USD', rate: 12500 }] });
    expect(result.status).toBe(200);
    expect(await defaultRateOf(id)).toBe(12500);
    const read = await get(id);
    expect(Number(read!.prices![0].rate)).toBe(12500);
    expect(read!.prices).toHaveLength(1);
    expect(await rows(id)).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('2. PUT default_rate alone rewrites the primary current row only', async () => {
    const id = await seedService({
      prices: [
        { currency_code: 'USD', rate: 10000, display_order: 0 },
        { currency_code: 'EUR', rate: 9000, display_order: 1 },
      ],
    });
    const result = await put(id, { default_rate: 9900 });
    expect(result.status).toBe(200);
    const read = await get(id);
    expect(read!.prices!.map((p: any) => [p.currency_code, Number(p.rate)])).toEqual([['USD', 9900], ['EUR', 9000]]);
    expect(await defaultRateOf(id)).toBe(9900);
  }, HOOK_TIMEOUT);

  it('2b. PUT default_rate on a service without price rows only writes default_rate', async () => {
    const id = await seedService({ prices: [] });
    expect((await put(id, { default_rate: 4200 })).status).toBe(200);
    expect(await defaultRateOf(id)).toBe(4200);
    expect(await rows(id)).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('3. default_rate that conflicts with prices[0] is a 400 and writes nothing', async () => {
    const id = await seedService({ prices: [{ currency_code: 'USD', rate: 10000 }] });
    const before = await snapshot(id);
    const result = await put(id, { service_name: 'Renamed', default_rate: 1, prices: [{ currency_code: 'USD', rate: 2 }] });
    expect(result.status).toBe(400);
    expect(await snapshot(id)).toEqual(before);
    expect((await table('service_catalog').where({ service_id: id }).first('service_name')).service_name).not.toBe('Renamed');
  }, HOOK_TIMEOUT);

  it.each([
    ['unsupported currency', { prices: [{ currency_code: 'XXX', rate: 100 }] }],
    ['lowercase currency', { prices: [{ currency_code: 'usd', rate: 100 }] }],
    ['duplicate currency', { prices: [{ currency_code: 'USD', rate: 1 }, { currency_code: 'USD', rate: 2 }] }],
    ['fractional rate', { prices: [{ currency_code: 'USD', rate: 10.5 }] }],
    ['negative rate', { prices: [{ currency_code: 'USD', rate: -1 }] }],
    ['future effective_date inside prices', { prices: [{ currency_code: 'USD', rate: 1, effective_date: FUTURE }] }],
    ['unknown key inside a price', { prices: [{ currency_code: 'USD', rate: 1, bogus: true }] }],
    ['top-level currency_code', { default_rate: 5, currency_code: 'EUR' }],
    ['duplicate scheduled (currency, date)', { scheduled_prices: [{ currency_code: 'USD', rate: 1, effective_date: FUTURE }, { currency_code: 'USD', rate: 2, effective_date: FUTURE }] }],
  ])('4. rejects %s with 400 and leaves the database unchanged', async (_label, body) => {
    const id = await seedService({ prices: [{ currency_code: 'USD', rate: 10000 }, { currency_code: 'USD', rate: 11000, effective_date: FUTURE }] });
    const before = await snapshot(id);
    const result = await put(id, body);
    expect(result.status).toBe(400);
    expect(await snapshot(id)).toEqual(before);
  }, HOOK_TIMEOUT);

  it('5. prices alone keeps scheduled rows; scheduled_prices: [] removes them; a past date is a 400', async () => {
    const id = await seedService({
      defaultRate: 10000,
      prices: [{ currency_code: 'USD', rate: 10000 }, { currency_code: 'USD', rate: 13000, effective_date: FUTURE }],
    });
    expect((await put(id, { prices: [{ currency_code: 'USD', rate: 10500 }] })).status).toBe(200);
    let read = await get(id);
    expect(read!.scheduled_prices).toHaveLength(1);
    expect(Number(read!.scheduled_prices![0].rate)).toBe(13000);

    const past = await put(id, { scheduled_prices: [{ currency_code: 'USD', rate: 1, effective_date: PAST }] });
    expect(past.status).toBe(400);
    expect((await get(id))!.scheduled_prices).toHaveLength(1);

    expect((await put(id, { scheduled_prices: [] })).status).toBe(200);
    read = await get(id);
    expect(read!.scheduled_prices).toHaveLength(0);
    expect(read!.prices).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('6. scheduled_prices never changes default_rate', async () => {
    const id = await seedService({ defaultRate: 10000, prices: [{ currency_code: 'USD', rate: 10000 }] });
    const result = await put(id, { scheduled_prices: [{ currency_code: 'USD', rate: 15000, effective_date: FUTURE }] });
    expect(result.status).toBe(200);
    expect(await defaultRateOf(id)).toBe(10000);
    const read = await get(id);
    expect(Number(read!.prices![0].rate)).toBe(10000);
    expect(Number(read!.scheduled_prices![0].rate)).toBe(15000);
  }, HOOK_TIMEOUT);

  it('7. POST with prices and no default_rate derives default_rate; POST with neither is a 400', async () => {
    const created = await post({
      service_name: 'Priced on create',
      custom_service_type_id: serviceTypeId,
      billing_method: 'fixed',
      unit_of_measure: 'each',
      prices: [{ currency_code: 'EUR', rate: 7700 }, { currency_code: 'USD', rate: 8800 }],
    });
    expect(created.status).toBe(200);
    const id = created.body.service_id;
    expect(await defaultRateOf(id)).toBe(7700);
    expect(created.body.prices.map((p: any) => p.currency_code)).toEqual(['EUR', 'USD']);

    const neither = await post({
      service_name: 'No rate',
      custom_service_type_id: serviceTypeId,
      billing_method: 'fixed',
      unit_of_measure: 'each',
    });
    expect(neither.status).toBe(400);
  }, HOOK_TIMEOUT);

  it('8. a GET -> PUT round trip with read echo fields succeeds and is idempotent', async () => {
    const id = await seedService({
      prices: [
        { currency_code: 'USD', rate: 10000, display_order: 0 },
        { currency_code: 'EUR', rate: 9000, display_order: 1 },
        { currency_code: 'USD', rate: 12000, effective_date: FUTURE },
      ],
    });
    const echo = async () => {
      const read = JSON.parse(JSON.stringify(await get(id)));
      return { service_name: read.service_name, default_rate: read.default_rate, prices: read.prices, scheduled_prices: read.scheduled_prices };
    };
    const body = await echo();
    expect(body.prices[0]).toHaveProperty('price_id');
    const first = await put(id, body);
    expect(first.status).toBe(200);
    const afterFirst = await snapshot(id);
    const second = await put(id, await echo());
    expect(second.status).toBe(200);
    const after = await snapshot(id);
    expect(after).toEqual(afterFirst);
    const read = await get(id);
    expect(read!.prices!.map((p: any) => p.currency_code)).toEqual(['USD', 'EUR']);
    expect(read!.scheduled_prices).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('9. display_order keeps the primary stable when physical row order changes', async () => {
    const id = await seedService({ prices: [] });
    // EUR is inserted before USD, but USD is primary.
    expect((await put(id, { prices: [{ currency_code: 'USD', rate: 100 }, { currency_code: 'EUR', rate: 90 }] })).status).toBe(200);
    // Rewrite rows so Postgres' physical order changes.
    await table('service_prices').where({ service_id: id, currency_code: 'USD' }).update({ rate: 101 });
    await table('service_prices').where({ service_id: id, currency_code: 'EUR' }).update({ rate: 91 });
    expect((await get(id))!.prices!.map((p: any) => p.currency_code)).toEqual(['USD', 'EUR']);
    const list = await serviceFor(ServiceCatalogService).list({ filters: {}, page: 1, limit: 100 }, ctx());
    const listed = (list.data as any[]).find((s) => s.service_id === id);
    expect(listed.prices.map((p: any) => p.currency_code)).toEqual(['USD', 'EUR']);
    // default_rate-only rewrite still targets the primary (USD), not whichever row sorts first physically.
    expect((await put(id, { default_rate: 555 })).status).toBe(200);
    const read = await get(id);
    expect(read!.prices!.map((p: any) => [p.currency_code, Number(p.rate)])).toEqual([['USD', 555], ['EUR', 91]]);
  }, HOOK_TIMEOUT);

  it('404 before writing anything when the service does not exist', async () => {
    const result = await put(uuidv4(), { prices: [{ currency_code: 'USD', rate: 1 }] });
    expect(result.status).toBe(404);
  }, HOOK_TIMEOUT);

  it('10. products API: PUT prices syncs default_rate and update is transactional', async () => {
    const productId = await seedService({ itemKind: 'product', defaultRate: 100, prices: [{ currency_code: 'USD', rate: 100 }] });
    const parsed = updateProductSchema.parse({ prices: [{ currency_code: 'EUR', rate: 3300 }, { currency_code: 'USD', rate: 3400 }] });
    await serviceFor(ProductCatalogService).update(productId, parsed as never, ctx());
    expect(await defaultRateOf(productId)).toBe(3300);
    const read = await serviceFor(ProductCatalogService).getById(productId, ctx());
    expect(read!.prices!.map((p: any) => p.currency_code)).toEqual(['EUR', 'USD']);

    // A failure after the price write (SKU unique violation on the catalog update) leaves nothing behind.
    const sku = `SKU-${uuidv4().slice(0, 8)}`;
    await seedService({ itemKind: 'product', sku });
    const before = await snapshot(productId);
    await expect(
      serviceFor(ProductCatalogService).update(
        productId,
        updateProductSchema.parse({ sku, prices: [{ currency_code: 'GBP', rate: 1 }] }) as never,
        ctx(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await snapshot(productId)).toEqual(before);
  }, HOOK_TIMEOUT);

  it('11. tenant isolation: another tenant cannot write this tenant\'s prices', async () => {
    const id = await seedService({ prices: [{ currency_code: 'USD', rate: 10000 }] });
    const before = await snapshot(id);
    const result = await put(id, { prices: [{ currency_code: 'USD', rate: 1 }] }, otherTenantId);
    expect(result.status).toBe(404);
    expect(await snapshot(id)).toEqual(before);
    expect(await rows(id, otherTenantId)).toHaveLength(0);
  }, HOOK_TIMEOUT);
});
