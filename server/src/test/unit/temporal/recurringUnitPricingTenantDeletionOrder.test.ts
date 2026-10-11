import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

function tenantDeletionOrder(source: string): string[] {
  const match = source.match(/const TENANT_TABLES_DELETION_ORDER: string\[\] = \[([\s\S]*?)\n\];/);
  if (!match) throw new Error('TENANT_TABLES_DELETION_ORDER not found');
  const body = match[1].replace(/\/\/.*$/gm, '');
  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((entry) => entry[1]);
}

describe('recurring unit pricing tenant deletion ordering', () => {
  const order = tenantDeletionOrder(
    readRepoFile('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts'),
  );

  it.each([
    'contract_line_unit_pricing_revisions',
    'contract_line_unit_pricing_revision_history',
    'contract_recurring_unit_adjustments',
  ])('purges %s with the tenant', (table) => {
    expect(order).toContain(table);
  });

  it('purges the FK-less seat-pricing stores before the contract lines they describe', () => {
    const contractLines = order.indexOf('contract_lines');
    for (const table of [
      'contract_line_unit_pricing_revisions',
      'contract_line_unit_pricing_revision_history',
      'contract_recurring_unit_adjustments',
    ]) {
      expect(order.indexOf(table)).toBeLessThan(contractLines);
    }
  });
});
