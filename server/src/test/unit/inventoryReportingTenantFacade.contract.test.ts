import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), 'utf8');
}

describe('inventory reporting tenant facade', () => {
  it('routes inventory reporting roots and joins through tenantDb', () => {
    const source = read('packages/inventory/src/actions/inventoryReportingActions.ts');

    expect(source).toContain('tenantDb');

    const directRootPattern =
      /\b(?:knex|knexOrTrx|trx|db)\s*(?:<[^>]+>)?\(\s*['`](?:product_inventory_settings|purchase_orders|sales_order_lines|sales_orders|service_catalog|stock_levels|stock_locations|stock_movements|stock_units|users)['`]/;
    expect(source).not.toMatch(directRootPattern);

    expect(source).not.toMatch(/\.where\(\{\s*tenant\s*[:,}]/);
    expect(source).not.toMatch(/\.(?:where|andWhere)\(\s*['`][^'`]*tenant['`]\s*,\s*tenant/);

    // The production Citus bug: a 3-arg users join with no tenant equality.
    expect(source).not.toMatch(/leftJoin\(\s*['`]users as u['`]\s*,\s*['`]u\.user_id['`]/);
  });

  it('has metadata for the inventory reporting roots', () => {
    const metadata = read('packages/db/src/lib/tenantTableMetadata.ts');

    for (const table of [
      'product_inventory_settings',
      'purchase_orders',
      'sales_order_lines',
      'sales_orders',
      'stock_levels',
      'stock_locations',
      'stock_movements',
      'stock_units',
    ]) {
      expect(metadata).toContain(`${table}: { scope: 'tenant' }`);
    }
  });
});
