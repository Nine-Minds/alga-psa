import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '..', '20261009120000_service_prices_display_order.cjs'));
// Scratch database: the test drops the column and re-applies the migration.
const SCRATCH_DB = process.env.TEST_DB_NAME_PRICE_ORDER_MIGRATION ?? 'test_db_price_display_order_migration';

let db: Knex;
const tenant = uuidv4();
const typeId = uuidv4();
const svcMatch = uuidv4();
const svcFallback = uuidv4();

const hasColumn = () => db.schema.hasColumn('service_prices', 'display_order');
const orderOf = async (serviceId: string) =>
  Object.fromEntries(
    (await db('service_prices').where({ tenant, service_id: serviceId, effective_date: '1970-01-01' }).select('currency_code', 'display_order'))
      .map((r: any) => [r.currency_code, r.display_order]),
  );

describe('20261009120000_service_prices_display_order', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: SCRATCH_DB });
    await migration.down(db);
    await db('tenants').insert({ tenant, client_name: 'Order Migration', email: 'order-migration@example.test', created_at: db.fn.now(), updated_at: db.fn.now() });
    await db('default_billing_settings').insert({ tenant, default_currency_code: 'EUR' }).onConflict('tenant').merge();
    await db('service_types').insert({ id: typeId, tenant, name: 'Order type' });
    const svc = (service_id: string, default_rate: number) => ({
      service_id, tenant, service_name: `svc ${service_id.slice(0, 6)}`, billing_method: 'fixed',
      custom_service_type_id: typeId, default_rate, unit_of_measure: 'each', item_kind: 'service', is_active: true,
    });
    await db('service_catalog').insert([svc(svcMatch, 1000), svc(svcFallback, 5)]);
    const price = (service_id: string, currency_code: string, rate: number, effective_date = '1970-01-01') =>
      ({ price_id: uuidv4(), tenant, service_id, currency_code, rate, effective_date });
    await db('service_prices').insert([
      price(svcMatch, 'EUR', 900), price(svcMatch, 'USD', 1000), price(svcMatch, 'GBP', 800),
      price(svcMatch, 'USD', 1100, '2999-01-01'), price(svcMatch, 'EUR', 1000, '2999-01-01'),
      price(svcFallback, 'USD', 10), price(svcFallback, 'EUR', 20),
    ]);
  }, 300_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('down removed the column, up adds it and backfills per the D5 rule', async () => {
    expect(await hasColumn()).toBe(false);
    await migration.up(db);
    expect(await hasColumn()).toBe(true);
    // rate == default_rate leads, others follow alphabetically
    expect(await orderOf(svcMatch)).toEqual({ USD: 0, EUR: 1, GBP: 2 });
    // no rate match: tenant default currency (EUR) leads
    expect(await orderOf(svcFallback)).toEqual({ EUR: 0, USD: 1 });
    // future window is numbered on its own: EUR rate 1000 equals default_rate
    const future = await db('service_prices').where({ tenant, service_id: svcMatch, effective_date: '2999-01-01' }).select('currency_code', 'display_order');
    expect(Object.fromEntries(future.map((r: any) => [r.currency_code, r.display_order]))).toEqual({ EUR: 0, USD: 1 });
  });

  it('is idempotent: a second up does not touch orders the application wrote', async () => {
    await db('service_prices').where({ tenant, service_id: svcMatch, currency_code: 'GBP', effective_date: '1970-01-01' }).update({ display_order: 7 });
    await migration.up(db);
    expect((await orderOf(svcMatch)).GBP).toBe(7);
  });

  it('down drops the column and can be repeated; up then re-applies', async () => {
    await migration.down(db);
    await migration.down(db);
    expect(await hasColumn()).toBe(false);
    await migration.up(db);
    expect(await hasColumn()).toBe(true);
    expect(await orderOf(svcMatch)).toEqual({ USD: 0, EUR: 1, GBP: 2 });
  });
});
