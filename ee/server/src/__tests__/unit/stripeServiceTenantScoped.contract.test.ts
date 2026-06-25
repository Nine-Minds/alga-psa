import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../lib/stripe/StripeService.ts'), 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

function expectNoDirectTenantRoot(section: string): void {
  expect(section).not.toMatch(/\.where\(\{\s*tenant\s*:/);
  expect(section).not.toMatch(/\.where\(['"]tenant['"],/);
}

describe('StripeService top billing paths tenant-scoped query contract', () => {
  it('centralizes tenant-scoped query construction for migrated Stripe roots', () => {
    expect(source).toContain("import { createTenantScopedQuery } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(conn: Knex, table: string, tenant: string): Knex.QueryBuilder');
    expect(source).toContain('createTenantScopedQuery(conn, { table, tenant }).builder');
  });

  it('uses structural tenant scoping for customer import and active subscription discovery', () => {
    const section = sectionBetween('async getOrImportCustomer', 'private async ensureStripePriceRecord');

    expect(section).toContain("tenantScopedTable(knex, 'stripe_customers', tenantId)");
    expect(section).toContain("tenantScopedTable(knex, 'tenants', tenantId)");
    expect(section).toContain("tenantScopedTable(db, 'stripe_customers', tenantId)");
    expectNoDirectTenantRoot(section);
  });

  it('uses structural tenant scoping while importing Stripe products, prices, and subscriptions', () => {
    const section = sectionBetween('private async ensureStripePriceRecord', 'async getUpcomingInvoicePreview');

    expect(section).toContain("tenantScopedTable(db, 'stripe_products', tenantId)");
    expect(section).toContain("tenantScopedTable(db, 'stripe_prices', tenantId)");
    expect(section).toContain("tenantScopedTable(db, 'stripe_subscriptions', tenantId)");
    expect(section).toContain(".where('stripe_product_external_id', baseProduct.id)");
    expect(section).toContain(".where('stripe_price_external_id', basePrice.id)");
    expectNoDirectTenantRoot(section);
  });

  it('uses structural tenant scoping for invoice preview, seat management, and checkout reads', () => {
    const section = sectionBetween('async getUpcomingInvoicePreview', 'async handleWebhookEvent');

    expect(section).toContain("tenantScopedTable(knex, 'stripe_subscriptions', tenantId)");
    expect(section).toContain("tenantScopedTable(knex, 'tenants', tenantId)");
    expect(section).toContain("tenantScopedTable(knex, 'tenants', tenantId).select('plan').first()");
    expect(section).toContain("tenantScopedTable(knex, 'tenants', tenantId).select('plan', 'product_code').first()");
    expectNoDirectTenantRoot(section);
  });

  it('uses structural tenant scoping for webhook bookkeeping, add-ons, and checkout completion', () => {
    const section = sectionBetween('async handleWebhookEvent', 'private async handleSubscriptionUpdated');

    expect(section).toContain("tenantScopedTable(knex, 'stripe_webhook_events', eventTenantId)");
    expect(section).toContain("tenantScopedTable(db, 'tenant_addons', tenantId)");
    expect(section).toContain("tenantScopedTable(knex, 'stripe_customers', tenantId)");
    expect(section).toContain("tenantScopedTable(knex, 'apple_iap_subscriptions', tenantId)");
    expect(section).toContain("tenantScopedTable(knex, 'tenants', tenantId)");
    expectNoDirectTenantRoot(section);
  });
});
