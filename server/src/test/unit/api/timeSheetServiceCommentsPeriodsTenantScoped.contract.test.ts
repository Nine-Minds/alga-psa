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

describe('time sheet service comments and periods tenant-scoped query contract', () => {
  it('uses structural tenant scoping for comments and time periods', () => {
    const section = sectionBetween('// Time sheet comments', '// Time period settings');

    expect(section).toContain('tenantDb(');
    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('time_sheet_comments')");
    expect(section).toContain(".table('time_periods')");
    expect(section).toContain(".table('time_sheets')");
    expect(section).toContain("const [period] = await trx('time_periods')");

    expect(section).not.toMatch(/knex\('time_sheet_comments'\)\s*\./);
    expect(section).not.toMatch(/knex\('time_periods'\)\s*\.(?:where|orderBy|first)/);
    expect(section).not.toMatch(/trx\('time_periods'\)\s*[\r\n]+\s*\.where/);
    expect(section).not.toMatch(/trx\('time_sheets'\)\s*[\r\n]+\s*\.where/);
    expect(section).not.toMatch(/\.where\(\{\s*period_id: id,\s*tenant: context\.tenant\s*\}\)/);
  });
});
