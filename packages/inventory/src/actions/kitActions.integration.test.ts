import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const testState = vi.hoisted(() => ({
  trx: null as any,
  tenant: '',
  user: { user_id: 'kit-action-test-user' },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: testState.trx })),
  withTransaction: vi.fn(async (_db: unknown, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
    callback(testState.trx)),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: unknown[]) => fn(testState.user, { tenant: testState.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn() }));

import {
  addKitComponent,
  createKitProduct,
  getKitDetail,
  listKitSummaries,
  removeKitComponent,
  updateKitProduct,
} from './kitActions';
import { listSalesOrders } from './salesOrderActions';
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
  stockLocationId = (await knex('stock_locations').where({ tenant: testState.tenant }).select('location_id').first()).location_id;
  clientId = (await knex('clients').where({ tenant: testState.tenant }).select('client_id').first()).client_id;
});

beforeEach(async () => {
  if (!databaseConnection) return;
  testState.trx = await knex.transaction();
});

afterEach(async () => {
  await testState.trx?.rollback();
  testState.trx = null;
});

afterAll(async () => {
  await knex?.destroy();
});

async function createKit(
  name: string,
  mode: 'sum' | 'fixed' = 'sum',
  fixedPrice?: number,
) {
  return createKitProduct({
    service_name: name,
    sku: `KIT-${randomUUID().slice(0, 8)}`,
    custom_service_type_id: serviceTypeId,
    unit_of_measure: 'kit',
    currency_code: 'USD',
    kit_pricing_mode: mode,
    kit_fixed_price: fixedPrice ?? null,
  });
}

async function createComponent(input: {
  name: string;
  price: number;
  cost: number;
  trackStock?: boolean;
  onHand?: number;
}): Promise<string> {
  const serviceId = randomUUID();
  await testState.trx('service_catalog').insert({
    tenant: testState.tenant,
    service_id: serviceId,
    service_name: input.name,
    description: '',
    custom_service_type_id: serviceTypeId,
    billing_method: 'usage',
    default_rate: input.price,
    unit_of_measure: 'each',
    category_id: null,
    tax_rate_id: null,
    item_kind: 'product',
    is_active: true,
    sku: `COMP-${randomUUID().slice(0, 8)}`,
    cost: input.cost,
    cost_currency: 'USD',
  });
  await testState.trx('service_prices').insert({
    tenant: testState.tenant,
    service_id: serviceId,
    currency_code: 'USD',
    rate: input.price,
  });
  if (input.trackStock) {
    await testState.trx('product_inventory_settings').insert({
      tenant: testState.tenant,
      service_id: serviceId,
      track_stock: true,
      is_serialized: false,
      is_kit: false,
      creates_asset_on_delivery: false,
      average_cost: input.cost,
      cost_currency: 'USD',
    });
    await testState.trx('stock_levels').insert({
      tenant: testState.tenant,
      service_id: serviceId,
      location_id: stockLocationId,
      quantity_on_hand: input.onHand ?? 0,
      reserved_quantity: 0,
      held_quantity: 0,
    });
  }
  return serviceId;
}

describe.skipIf(!databaseConnection)('kit actions (real DB, rolled back)', () => {
  it('T001: derives no-BOM, ready, low-stock, fixed/sum pricing, and non-stocked component detail', async () => {
    const noBom = await createKit(`No BOM ${randomUUID()}`);
    const ready = await createKit(`Ready sum ${randomUUID()}`);
    const low = await createKit(`Low fixed ${randomUUID()}`, 'fixed', 20000);
    const stocked = await createComponent({ name: `Stocked ${randomUUID()}`, price: 2500, cost: 1000, trackStock: true, onHand: 10 });
    const nonStocked = await createComponent({ name: `Non-stocked ${randomUUID()}`, price: 500, cost: 200 });

    await addKitComponent(ready.service_id, stocked, 2);
    await addKitComponent(ready.service_id, nonStocked, 1);
    await addKitComponent(low.service_id, stocked, 20);

    const summaries = await listKitSummaries();
    const noBomSummary = summaries.find((kit) => kit.service_id === noBom.service_id)!;
    const readySummary = summaries.find((kit) => kit.service_id === ready.service_id)!;
    const lowSummary = summaries.find((kit) => kit.service_id === low.service_id)!;

    expect(noBomSummary.status).toBe('no_bom');
    expect(readySummary).toMatchObject({
      status: 'ready',
      kit_pricing_mode: 'sum',
      component_count: 2,
      stocked_component_count: 1,
      short_component_count: 0,
      buildable_quantity: 5,
      computed_price: 5500,
    });
    expect(lowSummary).toMatchObject({
      status: 'low_stock',
      kit_pricing_mode: 'fixed',
      component_count: 1,
      short_component_count: 1,
      buildable_quantity: 0,
      computed_price: 20000,
    });

    const readyDetail = await getKitDetail(ready.service_id);
    expect(readyDetail?.components).toHaveLength(2);
    expect(readyDetail?.components.find((component) => component.component_service_id === nonStocked))
      .toMatchObject({ track_stock: false, component_buildable_quantity: null, extended_price: 500 });
  });

  it('T002: creates a product-backed kit and inventory settings in one action', async () => {
    const created = await createKit(`Created ${randomUUID()}`);
    const catalog = await testState.trx('service_catalog')
      .where({ tenant: testState.tenant, service_id: created.service_id })
      .first();
    const settings = await testState.trx('product_inventory_settings')
      .where({ tenant: testState.tenant, service_id: created.service_id })
      .first();
    const price = await testState.trx('service_prices')
      .where({ tenant: testState.tenant, service_id: created.service_id, currency_code: 'USD' })
      .first();

    expect(catalog).toMatchObject({ item_kind: 'product', default_rate: '0' });
    expect(settings).toMatchObject({ is_kit: true, kit_pricing_mode: 'sum', kit_fixed_price: null });
    expect(Number(price.rate)).toBe(0);
    expect(created.status).toBe('no_bom');
  });

  it('T003: updates identity and fixed pricing while rejecting a missing fixed amount', async () => {
    const fixed = await createKit(`Fixed ${randomUUID()}`, 'fixed', 10000);
    const updated = await updateKitProduct(fixed.service_id, {
      service_name: 'Updated fixed kit',
      sku: `UPDATED-${randomUUID().slice(0, 8)}`,
      kit_pricing_mode: 'fixed',
      kit_fixed_price: 15000,
      currency_code: 'USD',
    });

    const catalog = await testState.trx('service_catalog')
      .where({ tenant: testState.tenant, service_id: fixed.service_id })
      .first();
    const settings = await testState.trx('product_inventory_settings')
      .where({ tenant: testState.tenant, service_id: fixed.service_id })
      .first();
    expect(updated).toMatchObject({ service_name: 'Updated fixed kit', kit_fixed_price: 15000 });
    expect(Number(catalog.default_rate)).toBe(15000);
    expect(settings).toMatchObject({ kit_pricing_mode: 'fixed' });
    expect(Number(settings.kit_fixed_price)).toBe(15000);

    const sum = await createKit(`Sum ${randomUUID()}`);
    await expect(updateKitProduct(sum.service_id, { kit_pricing_mode: 'fixed' }))
      .rejects.toThrow('Fixed kit price must be greater than 0');
  });

  it('T004: adds, replaces duplicate quantity, validates, and removes BOM components', async () => {
    const kit = await createKit(`BOM ${randomUUID()}`);
    const component = await createComponent({ name: `Component ${randomUUID()}`, price: 1000, cost: 400 });

    await addKitComponent(kit.service_id, component, 2);
    await addKitComponent(kit.service_id, component, 5);
    const rows = await testState.trx('kit_components')
      .where({ tenant: testState.tenant, kit_service_id: kit.service_id, component_service_id: component });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(5);

    await expect(addKitComponent(kit.service_id, component, 0))
      .rejects.toThrow('Component quantity must be a positive integer');
    await removeKitComponent(kit.service_id, component);
    expect(await testState.trx('kit_components')
      .where({ tenant: testState.tenant, kit_service_id: kit.service_id, component_service_id: component }))
      .toHaveLength(0);
  });

  it('filters kit usage to sales orders containing the selected kit', async () => {
    const kit = await createKit(`Usage ${randomUUID()}`, 'fixed', 10000);
    const component = await createComponent({ name: `Other ${randomUUID()}`, price: 1000, cost: 400 });
    const matchingSoId = randomUUID();
    const otherSoId = randomUUID();

    await testState.trx('sales_orders').insert([
      {
        tenant: testState.tenant,
        so_id: matchingSoId,
        so_number: `SO-KIT-${randomUUID().slice(0, 8)}`,
        client_id: clientId,
        status: 'draft',
        currency_code: 'USD',
        invoice_mode: 'manual',
        allocation_mode: 'soft',
      },
      {
        tenant: testState.tenant,
        so_id: otherSoId,
        so_number: `SO-OTHER-${randomUUID().slice(0, 8)}`,
        client_id: clientId,
        status: 'draft',
        currency_code: 'USD',
        invoice_mode: 'manual',
        allocation_mode: 'soft',
      },
    ]);
    await testState.trx('sales_order_lines').insert([
      {
        tenant: testState.tenant,
        so_id: matchingSoId,
        service_id: kit.service_id,
        quantity_ordered: 1,
        quantity_fulfilled: 0,
        quantity_invoiced: 0,
        unit_price: 10000,
        fulfillment_type: 'from_stock',
      },
      {
        tenant: testState.tenant,
        so_id: otherSoId,
        service_id: component,
        quantity_ordered: 1,
        quantity_fulfilled: 0,
        quantity_invoiced: 0,
        unit_price: 1000,
        fulfillment_type: 'from_stock',
      },
    ]);

    const usage = await listSalesOrders({ serviceId: kit.service_id });
    expect(usage.map((order) => order.so_id)).toEqual([matchingSoId]);
  });
});
