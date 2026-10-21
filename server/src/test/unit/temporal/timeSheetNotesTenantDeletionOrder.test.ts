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

describe('time sheet notes tenant deletion ordering', () => {
  const order = parseDeletionOrder(
    readRepoFile('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts')
  );
  const createdTables = [
    ...readRepoFile('server/migrations/20261018010000_create_time_sheet_notes.cjs').matchAll(
      /const TABLE = '([a-z_]+)'/g
    ),
  ].map((m) => m[1]);

  it('deletes every table the time sheet notes migration creates', () => {
    expect(createdTables).toEqual(['time_sheet_notes']);
    for (const table of createdTables) {
      expect(order).toContain(table);
    }
  });

  it('deletes notes before the time sheets and users they reference', () => {
    const index = (table: string) => order.indexOf(table);
    expect(index('time_sheet_notes')).toBeLessThan(index('time_sheets'));
    expect(index('time_sheet_notes')).toBeLessThan(index('users'));
  });
});
