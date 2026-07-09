import { expect, test } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
} from './helpers/playwrightAuthSessionHelper';

applyPlaywrightAuthEnvDefaults();

const baseUrl = resolvePlaywrightBaseUrl();

async function seedKitComponent(db: Knex, tenant: string) {
  const suffix = uuidv4().slice(0, 8);
  const serviceTypeId = uuidv4();
  const componentServiceId = uuidv4();
  const existingLocation = await db('stock_locations')
    .where({ tenant, is_active: true })
    .select('location_id')
    .first();
  const locationId = existingLocation?.location_id ?? uuidv4();
  const typeName = `Kit hardware ${suffix}`;
  const componentName = `Monitor ${suffix}`;

  await db('service_types').insert({
    id: serviceTypeId,
    tenant,
    name: typeName,
    billing_method: 'usage',
    is_active: true,
    description: 'Inventory kit Playwright product type',
    order_number: 20,
    standard_service_type_id: null,
  });
  if (!existingLocation) {
    await db('stock_locations').insert({
      tenant,
      location_id: locationId,
      name: `Main warehouse ${suffix}`,
      location_type: 'warehouse',
      is_default: true,
      is_active: true,
    });
  }
  await db('service_catalog').insert({
    tenant,
    service_id: componentServiceId,
    service_name: componentName,
    description: 'Inventory kit Playwright component',
    custom_service_type_id: serviceTypeId,
    billing_method: 'usage',
    default_rate: 25000,
    unit_of_measure: 'each',
    category_id: null,
    tax_rate_id: null,
    item_kind: 'product',
    is_active: true,
    sku: `MON-${suffix}`,
    cost: 17500,
    cost_currency: 'USD',
  });
  await db('service_prices').insert({
    tenant,
    service_id: componentServiceId,
    currency_code: 'USD',
    rate: 25000,
  });
  await db('product_inventory_settings').insert({
    tenant,
    service_id: componentServiceId,
    track_stock: true,
    is_serialized: false,
    is_kit: false,
    creates_asset_on_delivery: false,
    average_cost: 17500,
    cost_currency: 'USD',
  });
  await db('stock_levels').insert({
    tenant,
    service_id: componentServiceId,
    location_id: locationId,
    quantity_on_hand: 10,
    reserved_quantity: 0,
    held_quantity: 0,
  });

  return { serviceTypeId, componentServiceId, typeName, componentName, suffix };
}

test('Inventory Kits command center end-to-end workflow', async ({ page }) => {
  test.setTimeout(300_000);
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Kit Playwright ${uuidv4().slice(0, 8)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: [{
        roleName: 'Admin',
        permissions: [
          { resource: 'inventory', action: 'create' },
          { resource: 'inventory', action: 'read' },
          { resource: 'inventory', action: 'update' },
          { resource: 'inventory', action: 'delete' },
          { resource: 'service', action: 'create' },
          { resource: 'service', action: 'read' },
          { resource: 'service', action: 'update' },
          { resource: 'sales_order', action: 'create' },
          { resource: 'sales_order', action: 'read' },
        ],
      }],
    });
    const tenant = tenantData.tenant.tenantId;
    const fixture = await seedKitComponent(db, tenant);
    const kitName = `Desk setup kit ${fixture.suffix}`;
    const kitSku = `KIT-${fixture.suffix}`;

    await page.goto(`${baseUrl}/msp/inventory/kits`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(page.locator('#kits-page')).toBeVisible();
    await expect(page.getByText('No inventory kits yet')).toBeVisible();

    await page.locator('#kits-create-kit-button').click();
    await expect(page.getByRole('dialog', { name: 'Create kit' })).toBeVisible();
    await page.locator('#kit-create-name').fill(kitName);
    await page.locator('#kit-create-sku').fill(kitSku);
    await page.locator('#kit-create-product-type').click();
    await page.getByRole('option', { name: fixture.typeName }).click();
    await expect(page.locator('#kit-create-fixed-price')).toHaveCount(0);
    await expect(page.getByText('Price will be calculated after components are added.')).toBeVisible();
    await page.locator('#kit-create-submit').click();

    await expect(page.locator('#kit-detail')).toContainText(kitName);
    await expect(page.locator('#kit-empty-bom-warning')).toBeVisible();
    await expect(page.locator('#kit-detail')).toContainText('No BOM');

    await page.locator('#kit-component-service').click();
    await page.getByRole('option', { name: fixture.componentName }).click();
    await page.locator('#kit-component-quantity').fill('2');
    await page.locator('#kit-add-component-button').click();

    await expect(page.locator('#kit-components-table')).toContainText(fixture.componentName);
    await expect(page.locator('#kit-detail')).toContainText('Ready');
    await expect(page.locator('#kit-detail')).toContainText('$500.00');
    await expect(page.locator('#kit-detail')).toContainText('Gross margin');

    await page.locator('#kit-sales-order-preview-quantity').fill('3');
    await expect(page.locator('#kit-detail')).toContainText(`6 × ${fixture.componentName}`);
    await expect(page.locator('#kit-detail')).toContainText('$1,500.00');

    await page.locator('#kits-search').fill('does-not-exist');
    await expect(page.getByText('No kits match those filters.')).toBeVisible();
    await page.locator('#kits-search').fill('');
    await page.locator('#kits-status-filter').click();
    await page.getByRole('option', { name: 'No BOM' }).click();
    await expect(page.getByText('No kits match those filters.')).toBeVisible();
    await page.locator('#kits-status-filter').click();
    await page.getByRole('option', { name: 'All' }).click();

    await page.locator('#kit-create-sales-order-link').click();
    await page.waitForURL(/\/msp\/inventory\/sales-orders\?create=1&service_id=/);
    await expect(page.getByRole('dialog', { name: 'Add Sales Order' })).toBeVisible();
    await expect(page.locator('#sales-order-line-0')).toContainText(kitName);
    await expect(page.locator('#sales-order-line-0')).toContainText('Calculated from components');

    const kit = await db('service_catalog')
      .where({ tenant, sku: kitSku })
      .select('service_id')
      .first();
    expect(kit).toBeDefined();
    const settings = await db('product_inventory_settings')
      .where({ tenant, service_id: kit.service_id })
      .first();
    expect(settings).toMatchObject({ is_kit: true, kit_pricing_mode: 'sum' });
    const bom = await db('kit_components')
      .where({ tenant, kit_service_id: kit.service_id, component_service_id: fixture.componentServiceId })
      .first();
    expect(Number(bom.quantity)).toBe(2);
  } finally {
    await db.destroy().catch(() => undefined);
  }
});
