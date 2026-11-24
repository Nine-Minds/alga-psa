import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';
import {
  createVendorCore,
  deactivateVendorCore,
  queryVendor,
  queryVendors,
  updateVendorCore,
} from './vendors';
import {
  deleteVendorProductCore,
  queryVendorProducts,
  upsertVendorProductCore,
} from './vendorProducts';
import { resolvePoLineDefaults } from './purchaseOrders';
import { isVendorCoreError, VendorCoreError } from './vendorErrors';

let knex: Knex;
let tenant: string;
let trx: Knex.Transaction;
let serviceTypeId: string;

async function createProduct(name: string): Promise<string> {
  const serviceId = randomUUID();
  await trx('service_catalog').insert({
    tenant,
    service_id: serviceId,
    service_name: name,
    item_kind: 'product',
    billing_method: 'usage',
    custom_service_type_id: serviceTypeId,
    default_rate: 5000,
    unit_of_measure: 'each',
    sku: `SKU-${serviceId.slice(0, 8)}`,
    cost: 700,
    cost_currency: 'USD',
    is_active: true,
  });
  return serviceId;
}

async function thrown(work: () => Promise<unknown>): Promise<VendorCoreError> {
  try {
    await work();
  } catch (error) {
    if (isVendorCoreError(error)) return error;
    throw error;
  }
  throw new Error('expected a VendorCoreError');
}

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: getInventoryTestDatabaseConnection(), pool: { min: 1, max: 2 } });
  tenant = await createInventoryTestTenant(knex);
  serviceTypeId = (await knex('service_types').where({ tenant }).select('id').first()).id;
});

beforeEach(async () => {
  trx = await knex.transaction();
});

afterEach(async () => {
  await trx?.rollback();
});

afterAll(async () => {
  await knex?.destroy();
});

describe('vendor cores (DB)', () => {
  it('T001: create, update, deactivate; deactivated vendor leaves the default list and returns with includeInactive', async () => {
    const created = await createVendorCore(trx, tenant, { vendor_name: '  Ingram Micro ', email: 'orders@ingram.example' });
    expect(created.ok).toBe(true);
    if (created.ok !== true) return;
    const vendorId = created.vendor.vendor_id;
    expect(created.vendor.vendor_name).toBe('Ingram Micro');

    const updated = await updateVendorCore(trx, tenant, vendorId, { payment_terms: 'Net 30', phone: '555-0100' });
    expect(updated).toMatchObject({ vendor_id: vendorId, payment_terms: 'Net 30', phone: '555-0100', email: 'orders@ingram.example' });

    const renamed = await updateVendorCore(trx, tenant, vendorId, { vendor_name: ' Ingram Micro Inc ' });
    expect(renamed.vendor_name).toBe('Ingram Micro Inc');

    expect((await queryVendors(trx, tenant, { search: 'ingram' })).data.map((v) => v.vendor_id)).toContain(vendorId);

    const deactivated = await deactivateVendorCore(trx, tenant, vendorId);
    expect(deactivated.is_active).toBe(false);

    expect((await queryVendors(trx, tenant, { search: 'ingram' })).data).toHaveLength(0);
    const withInactive = await queryVendors(trx, tenant, { search: 'ingram', includeInactive: true });
    expect(withInactive.data.map((v) => v.vendor_id)).toEqual([vendorId]);
    expect(withInactive.total).toBe(1);

    // Reactivation goes through update, as in the UI.
    expect((await updateVendorCore(trx, tenant, vendorId, { is_active: true })).is_active).toBe(true);
  });

  it('T001: deactivate is idempotent and refused only while open purchase orders exist', async () => {
    const created = await createVendorCore(trx, tenant, { vendor_name: 'Idempotent Supply' });
    if (created.ok !== true) throw new Error('create failed');
    const vendorId = created.vendor.vendor_id;

    const first = await deactivateVendorCore(trx, tenant, vendorId);
    const second = await deactivateVendorCore(trx, tenant, vendorId);
    expect(second.is_active).toBe(false);
    expect(String(second.updated_at)).toBe(String(first.updated_at));

    const busy = await createVendorCore(trx, tenant, { vendor_name: 'Busy Supply' });
    if (busy.ok !== true) throw new Error('create failed');
    await trx('purchase_orders').insert({
      tenant,
      po_id: randomUUID(),
      po_number: `PO-${randomUUID().slice(0, 8)}`,
      vendor_id: busy.vendor.vendor_id,
      status: 'open',
      currency_code: 'USD',
      is_drop_ship: false,
      created_by: (await knex('users').where({ tenant }).select('user_id').first()).user_id,
    });
    const refused = await thrown(() => deactivateVendorCore(trx, tenant, busy.vendor.vendor_id));
    expect(refused).toMatchObject({ kind: 'conflict', code: 'has_open_purchase_orders' });
    expect((await queryVendor(trx, tenant, busy.vendor.vendor_id))?.is_active).toBe(true);

    expect(await thrown(() => deactivateVendorCore(trx, tenant, randomUUID()))).toMatchObject({ kind: 'not_found' });
    expect(await thrown(() => updateVendorCore(trx, tenant, randomUUID(), { notes: 'x' }))).toMatchObject({ kind: 'not_found' });
  });

  it('T001: paginates and searches names without treating % or _ as wildcards', async () => {
    for (const name of ['Page A', 'Page B', 'Page C', 'Other_Co']) await createVendorCore(trx, tenant, { vendor_name: name });
    const page1 = await queryVendors(trx, tenant, { search: 'page', page: 1, limit: 2 });
    const page2 = await queryVendors(trx, tenant, { search: 'page', page: 2, limit: 2 });
    expect(page1.data.map((v) => v.vendor_name)).toEqual(['Page A', 'Page B']);
    expect(page2.data.map((v) => v.vendor_name)).toEqual(['Page C']);
    expect(page1.total).toBe(3);
    expect((await queryVendors(trx, tenant, { search: 'r_c' })).data.map((v) => v.vendor_name)).toEqual(['Other_Co']);
    expect((await queryVendors(trx, tenant, { search: '%' })).data).toHaveLength(0);
  });

  it('T002: a name matching an existing vendor after normalization is refused and no row is written', async () => {
    const first = await createVendorCore(trx, tenant, { vendor_name: 'Tech Data' });
    if (first.ok !== true) throw new Error('create failed');
    const before = Number((await trx('vendors').where({ tenant }).count({ count: '*' }).first())!.count);

    const duplicate = await createVendorCore(trx, tenant, { vendor_name: '  tech DATA ' });
    expect(duplicate).toEqual({ ok: false, code: 'duplicate_name', name: 'tech DATA' });
    expect(Number((await trx('vendors').where({ tenant }).count({ count: '*' }).first())!.count)).toBe(before);

    // Renaming another vendor onto the same normalized name is refused too, and names the holder.
    const other = await createVendorCore(trx, tenant, { vendor_name: 'Synnex' });
    if (other.ok !== true) throw new Error('create failed');
    const clash = await thrown(() => updateVendorCore(trx, tenant, other.vendor.vendor_id, { vendor_name: ' TECH data' }));
    expect(clash).toMatchObject({ kind: 'conflict', code: 'duplicate_name', details: { existing_vendor_id: first.vendor.vendor_id } });
    expect((await queryVendor(trx, tenant, other.vendor.vendor_id))?.vendor_name).toBe('Synnex');

    // A vendor may be saved under its own name with different casing.
    expect((await updateVendorCore(trx, tenant, first.vendor.vendor_id, { vendor_name: 'TECH DATA' })).vendor_name).toBe('TECH DATA');
  });

  it('T003: upsert, list with product name and SKU, and keep exactly one preferred offer per product', async () => {
    const a = await createVendorCore(trx, tenant, { vendor_name: 'Vendor A' });
    const b = await createVendorCore(trx, tenant, { vendor_name: 'Vendor B' });
    if (a.ok !== true || b.ok !== true) throw new Error('create failed');
    const serviceId = await createProduct('Switch 24p');

    const offerA = await upsertVendorProductCore(trx, tenant, {
      vendor_id: a.vendor.vendor_id, service_id: serviceId, vendor_sku: ' A-100 ', unit_cost: 12345, cost_currency: 'CAD', lead_time_days: 5, is_preferred: true,
    });
    expect(offerA).toMatchObject({ vendor_sku: 'A-100', cost_currency: 'CAD', is_preferred: true });
    expect(Number(offerA.unit_cost)).toBe(12345);

    const listed = await queryVendorProducts(trx, tenant, { vendor_id: a.vendor.vendor_id });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ service_name: 'Switch 24p', sku: expect.stringMatching(/^SKU-/), vendor_name: 'Vendor A' });

    // Upserting the same (vendor, product) updates in place.
    await upsertVendorProductCore(trx, tenant, { vendor_id: a.vendor.vendor_id, service_id: serviceId, unit_cost: 11000, cost_currency: 'CAD', is_preferred: true });
    expect(await queryVendorProducts(trx, tenant, { vendor_id: a.vendor.vendor_id })).toHaveLength(1);

    await upsertVendorProductCore(trx, tenant, { vendor_id: b.vendor.vendor_id, service_id: serviceId, unit_cost: 10000, cost_currency: 'CAD', is_preferred: true });
    const preferred = await trx('vendor_products').where({ tenant, service_id: serviceId, is_preferred: true }).select('vendor_id');
    expect(preferred.map((row) => row.vendor_id)).toEqual([b.vendor.vendor_id]);
  });

  it('T003: a missing cost_currency resolves to a currency, never an empty one; bad input and unknown records are typed errors', async () => {
    const v = await createVendorCore(trx, tenant, { vendor_name: 'Currency Vendor' });
    if (v.ok !== true) throw new Error('create failed');
    const serviceId = await createProduct('Currency Product');

    const offer = await upsertVendorProductCore(trx, tenant, { vendor_id: v.vendor.vendor_id, service_id: serviceId, unit_cost: 100 });
    expect(offer.cost_currency).toMatch(/^[A-Z]{3}$/);

    expect(await thrown(() => upsertVendorProductCore(trx, tenant, { vendor_id: v.vendor.vendor_id, service_id: serviceId, unit_cost: -1 })))
      .toMatchObject({ kind: 'validation', code: 'unit_cost_invalid' });
    expect(await thrown(() => upsertVendorProductCore(trx, tenant, { vendor_id: randomUUID(), service_id: serviceId })))
      .toMatchObject({ kind: 'not_found', code: 'vendor_not_found' });
    expect(await thrown(() => upsertVendorProductCore(trx, tenant, { vendor_id: v.vendor.vendor_id, service_id: randomUUID() })))
      .toMatchObject({ kind: 'not_found', code: 'product_not_found' });
  });

  it('T004: deleting a price list entry stops purchase order lines defaulting from it', async () => {
    const v = await createVendorCore(trx, tenant, { vendor_name: 'Pricing Vendor' });
    if (v.ok !== true) throw new Error('create failed');
    const serviceId = await createProduct('Priced Product');
    await upsertVendorProductCore(trx, tenant, { vendor_id: v.vendor.vendor_id, service_id: serviceId, vendor_sku: 'PV-1', unit_cost: 4200, cost_currency: 'USD' });

    expect(await resolvePoLineDefaults(trx, tenant, v.vendor.vendor_id, serviceId, 'USD')).toEqual({ unit_cost: 4200, vendor_sku: 'PV-1' });

    expect(await deleteVendorProductCore(trx, tenant, v.vendor.vendor_id, serviceId)).toEqual({ removed: true });
    expect(await queryVendorProducts(trx, tenant, { vendor_id: v.vendor.vendor_id })).toHaveLength(0);
    expect(await resolvePoLineDefaults(trx, tenant, v.vendor.vendor_id, serviceId, 'USD')).toEqual({ unit_cost: 700, vendor_sku: null });

    expect(await deleteVendorProductCore(trx, tenant, v.vendor.vendor_id, serviceId)).toEqual({ removed: false });
  });
});
