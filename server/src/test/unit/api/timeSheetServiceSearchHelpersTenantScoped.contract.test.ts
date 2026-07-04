import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TimeSheetService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('time sheet service search and helper tenant-scoped query contract', () => {
  it('uses structural tenant scoping for search and lower hydration helper roots', () => {
    const section = sectionBetween('// Search and statistics', 'async getScheduleEntry');

    expect(section).toContain('this.buildTenantScopedQuery(knex, context)');
    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('time_entries')");
    expect(section).toContain(".table('users')");

    expect(section).not.toMatch(/knex\(tableName\)\s*\./);
    expect(section).not.toMatch(/knex\('time_entries'\)\s*\./);
    expect(section).not.toMatch(/knex\('users'\)\s*\./);
    expect(section).not.toMatch(/\.where\(\{\s*time_sheet_id: timeSheetId,\s*tenant: context\.tenant\s*\}\)/);
    expect(section).not.toMatch(/\.where\(`\$\{tableName\}\.tenant`, context\.tenant\)/);
  });
});
