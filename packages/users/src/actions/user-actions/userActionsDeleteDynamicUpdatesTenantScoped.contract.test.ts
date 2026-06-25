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

describe('user actions delete dynamic updates tenant-scoped query contract', () => {
  it('uses structural tenant scoping for dynamic user cleanup update loops', () => {
    const deleteSection = sectionBetween('export const deleteUser', 'export const updateUser');
    const loopSection = sectionBetween('const nullColumns', 'const deleteByUserId');

    expect(deleteSection).toContain('const tenantScopedTable = (table: string) => createTenantScopedQuery(trx, {');
    expect(loopSection).toContain('await tenantScopedTable(table)');
    expect(loopSection).toContain('.update({ [column]: null })');
    expect(loopSection).toContain('.update({ [column]: actorId })');

    expect(loopSection).not.toMatch(/trx\(table\)\s*[\r\n]+\s*\.where\(\{\s*\[column\]: userId,\s*tenant: tenantOrUndef\s*\}\)/);
  });
});
