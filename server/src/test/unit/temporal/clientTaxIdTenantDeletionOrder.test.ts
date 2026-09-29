import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

// Mirrors scripts/validate-tenant-management.ts so the test sees the same list.
function parseDeletionOrder(source: string): string[] {
  const arrayMatch = source.match(
    /const\s+TENANT_TABLES_DELETION_ORDER\s*:\s*string\[\]\s*=\s*\[([\s\S]*?)\n\];/
  );
  if (!arrayMatch) throw new Error('TENANT_TABLES_DELETION_ORDER not found');
  const withoutComments = arrayMatch[1].replace(/\/\/.*$/gm, '');
  return [...withoutComments.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('client tax ID tenant deletion ordering', () => {
  const order = parseDeletionOrder(
    readRepoFile('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts')
  );
  const migration = readRepoFile('server/migrations/20260923090000_consolidate_client_tax_id.cjs');

  it('deletes every tenant table the tax ID consolidation migration creates', () => {
    const created = [...migration.matchAll(/createTable\('([a-z_]+)'/g)].map((m) => m[1]);

    expect(created).toContain('client_tax_id_migration_conflicts');
    for (const table of created) {
      expect(order).toContain(table);
    }
  });

  it('deletes the conflict audit rows before the clients they describe', () => {
    expect(order.indexOf('client_tax_id_migration_conflicts')).toBeLessThan(order.indexOf('clients'));
  });
});
