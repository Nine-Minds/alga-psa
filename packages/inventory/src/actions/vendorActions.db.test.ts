import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const testState = vi.hoisted(() => ({
  trx: null as any,
  tenant: '',
  user: { user_id: 'vendor-action-test-user' },
  permissions: new Set<string>(),
}));

vi.mock('@alga-psa/db', async () => ({
  ...(await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db')),
  createTenantKnex: vi.fn(async () => ({ knex: testState.trx })),
  withTransaction: vi.fn(async (_db: unknown, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
    testState.trx.transaction(callback)),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: unknown[]) => fn(testState.user, { tenant: testState.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) =>
    testState.permissions.has(`${resource}:${action}`)),
}));

import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { createVendor, deactivateVendor, getVendor, listVendors, updateVendor } from './vendorActions';
import { deleteVendorProduct, listVendorProducts, upsertVendorProduct } from './vendorProductActions';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

let knex: Knex;

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: getInventoryTestDatabaseConnection(), pool: { min: 1, max: 2 } });
  testState.tenant = await createInventoryTestTenant(knex);
  testState.user.user_id = (await knex('users').where({ tenant: testState.tenant }).select('user_id').first()).user_id;
});

beforeEach(async () => {
  testState.trx = await knex.transaction();
  testState.permissions = new Set(['vendor:read', 'vendor:create', 'vendor:update']);
});

afterEach(async () => {
  await testState.trx?.rollback();
  testState.trx = null;
});

afterAll(async () => {
  await knex?.destroy();
});

function messageOf(result: unknown): string | undefined {
  return isActionMessageError(result) ? (result as any).actionError : undefined;
}

describe('vendor actions still return their translated messages after the core extraction (T006)', () => {
  it('create/update map duplicate and blank names; update and deactivate map a missing vendor', async () => {
    const a: any = await createVendor({ vendor_name: 'Alpha Supply' });
    const b: any = await createVendor({ vendor_name: 'Beta Supply' });
    expect(a.vendor_id).toBeTruthy();

    const dup = await createVendor({ vendor_name: ' alpha supply ' });
    expect(isActionMessageError(dup)).toBe(true);
    expect(messageOf(dup)).toBe('A vendor named "alpha supply" already exists');

    const renameClash = await updateVendor(b.vendor_id, { vendor_name: 'ALPHA SUPPLY' });
    expect(messageOf(renameClash)).toBe('A vendor named "ALPHA SUPPLY" already exists');
    const blank = await updateVendor(b.vendor_id, { vendor_name: '   ' });
    expect(messageOf(blank)).toBe('Vendor name is required');

    expect(messageOf(await updateVendor(randomUUID(), { notes: 'x' }))).toBe('Vendor not found');
    expect(messageOf(await deactivateVendor(randomUUID()))).toBe('Vendor not found');

    const renamed: any = await updateVendor(b.vendor_id, { vendor_name: ' Beta Supply Co ', is_active: true });
    expect(renamed).toMatchObject({ vendor_name: 'Beta Supply Co', is_active: true });
  });

  it('deactivate refuses open purchase orders and reactivates through update; list honours includeInactive', async () => {
    const v: any = await createVendor({ vendor_name: 'Gamma Supply' });
    const poId = randomUUID();
    await testState.trx('purchase_orders').insert({
      tenant: testState.tenant, po_id: poId, po_number: `PO-${poId.slice(0, 8)}`, vendor_id: v.vendor_id,
      status: 'partially_received', currency_code: 'USD', is_drop_ship: false, created_by: testState.user.user_id,
    });
    expect(messageOf(await deactivateVendor(v.vendor_id))).toBe('Cannot deactivate a vendor with open purchase orders');

    await testState.trx('purchase_orders').where({ tenant: testState.tenant, po_id: poId }).update({ status: 'received' });
    const off: any = await deactivateVendor(v.vendor_id);
    expect(off.is_active).toBe(false);
    expect(((await listVendors({})) as any[]).map((row) => row.vendor_id)).not.toContain(v.vendor_id);
    expect(((await listVendors({ includeInactive: true })) as any[]).map((row) => row.vendor_id)).toContain(v.vendor_id);
    expect(((await getVendor(v.vendor_id)) as any).is_active).toBe(false);
    expect(((await updateVendor(v.vendor_id, { is_active: true })) as any).is_active).toBe(true);
  });

  it('permission failures keep their shape', async () => {
    testState.permissions = new Set();
    expect(isActionPermissionError(await listVendors({}))).toBe(true);
    expect(isActionPermissionError(await createVendor({ vendor_name: 'X' }))).toBe(true);
    expect(isActionPermissionError(await deactivateVendor(randomUUID()))).toBe(true);
    expect(isActionPermissionError(await deleteVendorProduct(randomUUID(), randomUUID()))).toBe(true);
  });

  it('price list actions map validation and unknown records to their messages and keep the {removed} shape', async () => {
    const v: any = await createVendor({ vendor_name: 'Delta Supply' });
    const serviceTypeId = (await knex('service_types').where({ tenant: testState.tenant }).select('id').first()).id;
    const serviceId = randomUUID();
    await testState.trx('service_catalog').insert({
      tenant: testState.tenant, service_id: serviceId, service_name: 'Action Product', item_kind: 'product',
      billing_method: 'usage', custom_service_type_id: serviceTypeId, default_rate: 1, unit_of_measure: 'each', is_active: true,
    });

    expect(messageOf(await upsertVendorProduct({ vendor_id: '', service_id: serviceId })))
      .toBe('Choose both a vendor and a product before saving the offer.');
    expect(messageOf(await upsertVendorProduct({ vendor_id: v.vendor_id, service_id: serviceId, unit_cost: -1 })))
      .toBe('Vendor cost must be a non-negative amount.');
    const invalid = 'The selected vendor or product is no longer valid. Please refresh and try again.';
    expect(messageOf(await upsertVendorProduct({ vendor_id: randomUUID(), service_id: serviceId }))).toBe(invalid);
    expect(messageOf(await upsertVendorProduct({ vendor_id: v.vendor_id, service_id: randomUUID() }))).toBe(invalid);

    const saved: any = await upsertVendorProduct({ vendor_id: v.vendor_id, service_id: serviceId, vendor_sku: 'D-1', unit_cost: 500, cost_currency: 'USD' });
    expect(saved).toMatchObject({ vendor_sku: 'D-1', cost_currency: 'USD' });
    const listed: any[] = (await listVendorProducts({ vendor_id: v.vendor_id })) as any;
    expect(listed).toEqual([expect.objectContaining({ service_name: 'Action Product', vendor_name: 'Delta Supply' })]);
    expect(await deleteVendorProduct(v.vendor_id, serviceId)).toEqual({ removed: true });
    expect(await deleteVendorProduct(v.vendor_id, serviceId)).toEqual({ removed: false });
  });
});
