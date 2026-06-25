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

describe('time sheet service list tenant-scoped query contract', () => {
  it('uses structural tenant scoping for time-sheet list roots', () => {
    const listSection = sectionBetween('async list(', 'async getById');

    expect(source).toContain('createTenantScopedQuery');
    expect(listSection).toContain('this.buildTenantScopedQuery(knex, context)');
    expect(listSection).toContain('createTenantScopedQuery(knex, {');
    expect(listSection).toContain("table: 'time_entries'");
    expect(listSection).toContain(".andOn('time_sheets.tenant', '=', 'time_periods.tenant')");
    expect(listSection).toContain(".andOn('time_sheets.tenant', '=', 'users.tenant')");

    expect(listSection).not.toMatch(/knex\(this\.tableName\)\s*[\r\n]+\s*\.where\(`\$\{this\.tableName\}\.tenant`, context\.tenant\)/);
    expect(listSection).not.toMatch(/knex\('time_entries'\)\s*\./);
  });
});
