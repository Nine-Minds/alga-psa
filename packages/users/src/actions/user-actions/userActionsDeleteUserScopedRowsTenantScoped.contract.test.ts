import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'userActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('user actions delete user-scoped rows tenant-scoped query contract', () => {
  it('uses structural tenant scoping for user-scoped delete loops and activity groups', () => {
    const section = sectionBetween('const deleteByUserId', '// ── EE-only tables');

    expect(section).toContain('await tenantScopedTable(table).where({ user_id: userId }).del()');
    expect(section).toContain("await tenantScopedTable('import_jobs').where({ created_by: userId }).del()");
    expect(section).toContain("await tenantScopedTable('user_activity_group_items')");
    expect(section).toContain("tenantScopedTable('user_activity_groups')");

    expect(section).not.toMatch(/trx\(table\)\.where\(\{\s*user_id: userId,\s*tenant: tenantOrUndef\s*\}\)\.del\(\)/);
    expect(section).not.toMatch(/trx\('import_jobs'\)\.where\(\{\s*created_by: userId,\s*tenant: tenantOrUndef\s*\}\)\.del\(\)/);
    expect(section).not.toMatch(/trx\('user_activity_group_items'\)\s*[\r\n]+\s*\.where\(\{\s*tenant: tenantOrUndef\s*\}\)/);
    expect(section).not.toMatch(/trx\('user_activity_groups'\)\.where\(\{\s*user_id: userId,\s*tenant: tenantOrUndef\s*\}\)\.del\(\)/);
  });
});
