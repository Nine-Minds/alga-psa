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

describe('unit of measure tenant deletion ordering', () => {
  const order = parseDeletionOrder(
    readRepoFile('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts')
  );
  const migration = readRepoFile('server/migrations/20260927100000_create_units_of_measure_vocabulary.cjs');

  it('deletes every tenant-scoped table the units of measure migration creates', () => {
    const created = [...migration.matchAll(/CREATE TABLE ([a-z_]+) \(\s*tenant uuid/g)].map((m) => m[1]);

    expect(created).toEqual(['tenant_units_of_measure']);
    for (const table of created) {
      expect(order).toContain(table);
    }
  });

  it('does not schedule the global units_of_measure vocabulary for tenant deletion', () => {
    expect(order).not.toContain('units_of_measure');
  });
});
