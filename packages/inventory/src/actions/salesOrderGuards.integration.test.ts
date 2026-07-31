import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const testState = vi.hoisted(() => ({
  trx: null as any,
  tenant: '',
  user: { user_id: 'sales-order-guard-test-user' },
  permissions: new Set<string>(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: testState.trx })),
  withTransaction: vi.fn(async (_db: unknown, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
    callback(testState.trx)),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: unknown[]) => fn(testState.user, { tenant: testState.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) =>
    testState.permissions.has(`${resource}:${action}`)),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn() }));

import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { createDropShipForSoLine, confirmDropShipShipment } from './dropShipActions';
import { fulfillSalesOrderLine } from './fulfillmentActions';
import { removeSoLine, suggestPoFromBackorder, updateSoLine } from './salesOrderActions';
import { getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();

let knex: Knex;
let serviceTypeId: string;
let stockLocationId: string;
let clientId: string;

beforeAll(async () => {
  if (!databaseConnection) return;
  knex = knexLib({
    client: 'pg',
    connection: databaseConnection,
    pool: { min: 1, max: 2 },
  });
  testState.tenant = (await knex('tenants').select('tenant').first()).tenant;
  serviceTypeId = (await knex('service_types').where({ tenant: testState.tenant }).select('id').first()).id;
  stockLocationId = (await knex('stock_locations')
    .where({ tenant: testState.tenant })
    .whereNull('assigned_user_id')
    .select('location_id')
    .first()).location_id;
  clientId = (await knex('clients').where({ tenant: testState.tenant }).select('client_id').first()).client_id;
  testState.user.user_id = (await knex('users')
    .where({ tenant: testState.tenant })
    .select('user_id')
    .first()).user_id;
});

beforeEach(async () => {
  if (!databaseConnection) return;
  testState.trx = await knex.transaction();
  testState.permissions = new Set([
    'sales_order:read',
    'sales_order:update',
    'purchase_order:create',
  ]);
});

afterEach(async () => {
  await testState.trx?.rollback();
  testState.trx = null;
});

afterAll(async () => {
  await knex?.destroy();
});

async function createVendor(): Promise<string> {
  const [vendor] = await testState.trx('vendors')
    .insert({
      tenant: testState.tenant,
      vendor_name: `Guard vendor ${randomUUID()}`,
      is_active: true,
    })
    .returning('vendor_id');
  return vendor.vendor_id;
}

async function createProduct(input?: {
  onHand?: number;
  preferredVendorId?: string | null;
}): Promise<string> {
  const serviceId = randomUUID();
  await testState.trx('service_catalog').insert({
    tenant: testState.tenant,
    service_id: serviceId,
    service_name: `Guard product ${randomUUID()}`,
    description: '',
    custom_service_type_id: serviceTypeId,
    billing_method: 'usage',
    default_rate: 2500,
    unit_of_measure: 'each',
    category_id: null,
    tax_rate_id: null,
    item_kind: 'product',
    is_active: true,
    sku: `GUARD-${randomUUID().slice(0, 8)}`,
    cost: 1000,
    cost_currency: 'USD',
  });
  await testState.trx('product_inventory_settings').insert({
    tenant: testState.tenant,
    service_id: serviceId,
    track_stock: true,
    is_serialized: false,
    is_kit: false,
    creates_asset_on_delivery: false,
    average_cost: 1000,
    cost_currency: 'USD',
    default_location_id: stockLocationId,
    preferred_vendor_id: input?.preferredVendorId ?? null,
  });
  await testState.trx('stock_levels').insert({
    tenant: testState.tenant,
    service_id: serviceId,
    location_id: stockLocationId,
    quantity_on_hand: input?.onHand ?? 10,
    reserved_quantity: 0,
    held_quantity: 0,
  });
  return serviceId;
}

async function createSalesOrderLine(input: {
  status: 'draft' | 'confirmed' | 'invoiced' | 'cancelled';
  serviceId: string;
  fulfillmentType?: 'from_stock' | 'drop_ship';
  quantity?: number;
}): Promise<{ soId: string; soLineId: string; soNumber: string }> {
  const soId = randomUUID();
  const soLineId = randomUUID();
  const soNumber = `SO-GUARD-${randomUUID().slice(0, 8)}`;
  await testState.trx('sales_orders').insert({
    tenant: testState.tenant,
    so_id: soId,
    so_number: soNumber,
    client_id: clientId,
    status: input.status,
    currency_code: 'USD',
    invoice_mode: 'manual',
    allocation_mode: 'soft',
  });
  await testState.trx('sales_order_lines').insert({
    tenant: testState.tenant,
    so_line_id: soLineId,
    so_id: soId,
    service_id: input.serviceId,
    quantity_ordered: input.quantity ?? 2,
    quantity_fulfilled: 0,
    quantity_invoiced: 0,
    unit_price: 2500,
    fulfillment_type: input.fulfillmentType ?? 'from_stock',
  });
  return { soId, soLineId, soNumber };
}

function expectActionError(result: unknown, messageSubstring: string): void {
  expect(isActionMessageError(result)).toBe(true);
  if (!isActionMessageError(result)) {
    throw new Error('Expected an action message error');
  }
  expect(result.actionError.toLowerCase()).toContain(messageSubstring.toLowerCase());
}

function expectPermissionError(result: unknown, messageSubstring: string): void {
  expect(isActionPermissionError(result)).toBe(true);
  if (!isActionPermissionError(result)) {
    throw new Error('Expected an action permission error');
  }
  expect(result.permissionError.toLowerCase()).toContain(messageSubstring.toLowerCase());
}

async function salesOrderMovementCount(soId: string): Promise<number> {
  const row = await testState.trx('stock_movements')
    .where({
      tenant: testState.tenant,
      source_doc_type: 'sales_order',
      source_doc_id: soId,
    })
    .count('* as count')
    .first();
  return Number(row?.count ?? 0);
}

async function purchaseOrdersForSoLine(soLineId: string): Promise<Array<{ po_id: string; po_number: string }>> {
  return testState.trx('purchase_orders as po')
    .join('purchase_order_lines as pol', function (this: Knex.JoinClause) {
      this.on('po.po_id', '=', 'pol.po_id').andOn('po.tenant', '=', 'pol.tenant');
    })
    .where({
      'po.tenant': testState.tenant,
      'pol.source_so_line_id': soLineId,
    })
    .select('po.po_id', 'po.po_number');
}

describe.skipIf(!databaseConnection)('sales-order state guards (real DB, rolled back)', () => {
  it('T001: rejects fulfillment for a draft order without moving stock', async () => {
    const serviceId = await createProduct();
    const { soId, soLineId } = await createSalesOrderLine({ status: 'draft', serviceId });

    const result = await fulfillSalesOrderLine(soLineId, { location_id: stockLocationId, quantity: 1 });

    expectActionError(result, 'draft');
    expect(await salesOrderMovementCount(soId)).toBe(0);
  });

  it('T002: fulfills a confirmed order', async () => {
    const serviceId = await createProduct();
    const { soId, soLineId } = await createSalesOrderLine({ status: 'confirmed', serviceId });

    const result = await fulfillSalesOrderLine(soLineId, { location_id: stockLocationId, quantity: 1 });

    expect(isActionMessageError(result)).toBe(false);
    expect(result).toMatchObject({
      so_line_id: soLineId,
      quantity_fulfilled: 1,
      line_quantity_fulfilled: 1,
      so_status: 'partially_fulfilled',
    });
    expect(await salesOrderMovementCount(soId)).toBe(1);
  });

  it('T003: fulfills an invoiced manual-mode order', async () => {
    const serviceId = await createProduct();
    const { soId, soLineId } = await createSalesOrderLine({ status: 'invoiced', serviceId });

    const result = await fulfillSalesOrderLine(soLineId, { location_id: stockLocationId, quantity: 1 });

    expect(isActionMessageError(result)).toBe(false);
    expect(result).toMatchObject({
      so_line_id: soLineId,
      quantity_fulfilled: 1,
      line_quantity_fulfilled: 1,
      so_status: 'invoiced',
    });
    expect(await salesOrderMovementCount(soId)).toBe(1);
  });

  it('T004: rejects fulfillment for a cancelled order', async () => {
    const serviceId = await createProduct();
    const { soId, soLineId } = await createSalesOrderLine({ status: 'cancelled', serviceId });

    const result = await fulfillSalesOrderLine(soLineId, { location_id: stockLocationId, quantity: 1 });

    expectActionError(result, 'cancelled');
    expect(await salesOrderMovementCount(soId)).toBe(0);
  });

  it('T005: rejects a duplicate drop-ship PO and reports the existing PO number', async () => {
    const vendorId = await createVendor();
    const serviceId = await createProduct();
    const { soLineId } = await createSalesOrderLine({
      status: 'confirmed',
      serviceId,
      fulfillmentType: 'drop_ship',
    });

    const first = await createDropShipForSoLine(soLineId, { vendor_id: vendorId });
    expect(isActionMessageError(first)).toBe(false);
    expect(isActionPermissionError(first)).toBe(false);
    expect(first).toHaveProperty('po_number');
    const poNumber = (first as { po_number: string }).po_number;

    const second = await createDropShipForSoLine(soLineId, { vendor_id: vendorId });

    expectActionError(second, poNumber);
    expect(await purchaseOrdersForSoLine(soLineId)).toHaveLength(1);
  });

  it('T006: rejects drop-ship PO creation for a cancelled order', async () => {
    const vendorId = await createVendor();
    const serviceId = await createProduct();
    const { soLineId } = await createSalesOrderLine({
      status: 'cancelled',
      serviceId,
      fulfillmentType: 'drop_ship',
    });

    const result = await createDropShipForSoLine(soLineId, { vendor_id: vendorId });

    expectActionError(result, 'cancelled');
    expect(await purchaseOrdersForSoLine(soLineId)).toHaveLength(0);
  });

  it('T007: denies drop-ship PO creation without purchase-order create permission', async () => {
    const vendorId = await createVendor();
    const serviceId = await createProduct();
    const { soLineId } = await createSalesOrderLine({
      status: 'confirmed',
      serviceId,
      fulfillmentType: 'drop_ship',
    });
    testState.permissions = new Set(['sales_order:read', 'sales_order:update']);

    const result = await createDropShipForSoLine(soLineId, { vendor_id: vendorId });

    expectPermissionError(result, 'purchase_order create');
    expect(await purchaseOrdersForSoLine(soLineId)).toHaveLength(0);
  });

  it('T008: rejects backorder procurement for a cancelled order without creating a PO', async () => {
    const vendorId = await createVendor();
    const serviceId = await createProduct({ onHand: 0, preferredVendorId: vendorId });
    const { soLineId, soId } = await createSalesOrderLine({ status: 'cancelled', serviceId });

    const result = await suggestPoFromBackorder(soId);

    expectActionError(result, 'cancelled');
    expect(await purchaseOrdersForSoLine(soLineId)).toHaveLength(0);
  });

  it('T009: rejects line edits on a confirmed order and leaves the line unchanged', async () => {
    const serviceId = await createProduct();
    const { soLineId } = await createSalesOrderLine({ status: 'confirmed', serviceId });

    const updateResult = await updateSoLine(soLineId, {
      quantity_ordered: 9,
      unit_price: 9999,
    });
    const removeResult = await removeSoLine(soLineId);

    expectActionError(updateResult, 'confirmed');
    expectActionError(removeResult, 'confirmed');
    const line = await testState.trx('sales_order_lines')
      .where({ tenant: testState.tenant, so_line_id: soLineId })
      .first();
    expect(line).toBeTruthy();
    expect(Number(line.quantity_ordered)).toBe(2);
    expect(Number(line.unit_price)).toBe(2500);
  });

  it('T010: rejects drop-ship shipment confirmation for a cancelled order without fulfillment writes', async () => {
    const vendorId = await createVendor();
    const serviceId = await createProduct();
    const { soId, soLineId } = await createSalesOrderLine({
      status: 'confirmed',
      serviceId,
      fulfillmentType: 'drop_ship',
    });
    const po = await createDropShipForSoLine(soLineId, { vendor_id: vendorId });
    expect(isActionMessageError(po)).toBe(false);
    expect(isActionPermissionError(po)).toBe(false);
    await testState.trx('sales_orders')
      .where({ tenant: testState.tenant, so_id: soId })
      .update({ status: 'cancelled' });

    const result = await confirmDropShipShipment({ so_line_id: soLineId });

    expectActionError(result, 'cancelled');
    expect(await salesOrderMovementCount(soId)).toBe(0);
    const soLine = await testState.trx('sales_order_lines')
      .where({ tenant: testState.tenant, so_line_id: soLineId })
      .first();
    const poLine = await testState.trx('purchase_order_lines')
      .where({ tenant: testState.tenant, source_so_line_id: soLineId })
      .first();
    expect(Number(soLine.quantity_fulfilled)).toBe(0);
    expect(Number(poLine.quantity_received)).toBe(0);
  });
});
