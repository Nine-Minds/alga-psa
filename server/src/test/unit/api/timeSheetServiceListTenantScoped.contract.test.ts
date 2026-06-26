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

    expect(source).not.toContain('createTenantScopedQuery');
    expect(listSection).toContain('this.buildTenantScopedQuery(knex, context)');
    expect(listSection).toContain('const db = tenantDb(knex, context.tenant);');
    expect(listSection).toContain(".table('time_entries')");
    expect(listSection).toContain("db.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id')");
    expect(listSection).toContain("db.tenantJoin(query, 'users', 'time_sheets.user_id', 'users.user_id', { type: 'left' })");
    expect(listSection).toContain("db.tenantJoin(query, 'users as approvers', 'time_sheets.approved_by', 'approvers.user_id', { type: 'left' })");
    expect(listSection).toContain("db.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id', { type: 'left' })");

    expect(listSection).not.toMatch(/knex\(this\.tableName\)\s*[\r\n]+\s*\.where\(`\$\{this\.tableName\}\.tenant`, context\.tenant\)/);
    expect(listSection).not.toMatch(/knex\('time_entries'\)\s*\./);
    expect(listSection).not.toMatch(/\.andOn\([^)]*tenant/);
  });
});
