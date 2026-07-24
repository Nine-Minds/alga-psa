import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./helpdeskReportActions.ts', import.meta.url), 'utf8');

function employeeUtilizationSection(): string {
  const start = source.indexOf('export const getEmployeeUtilizationReport');
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start);
}

describe('employee utilization report tenant-scoped query contract', () => {
  it('gates on report read permission and scopes every query through tenantDb', () => {
    const section = employeeUtilizationSection();

    expect(section).toContain('await assertCanReadReports(user, knex)');
    expect(section).toContain('const scopedDb = tenantDb(knex, tenant);');

    // All three source tables are read through the tenant-scoped builder.
    expect(section).toContain("scopedDb.table('users')");
    expect(section).toContain("scopedDb.table('time_entries')");
    expect(section).toContain("scopedDb.table('resources')");

    // No raw un-scoped table access.
    expect(section).not.toContain("knex('users')");
    expect(section).not.toContain("knex('time_entries')");
    expect(section).not.toContain("knex('resources')");
  });

  it('restricts the roster to active internal users and windows time entries by range', () => {
    const section = employeeUtilizationSection();

    expect(section).toContain("where('user_type', 'internal')");
    expect(section).toContain("where('is_inactive', false)");
    expect(section).toContain("where('start_time', '>=', knex.raw(`NOW() - INTERVAL '${rangeDays} days'`))");
  });

  it('delegates utilization math to the pure builder', () => {
    const section = employeeUtilizationSection();
    expect(section).toContain('return buildEmployeeUtilizationReport(inputRows, rangeDays);');
  });
});
