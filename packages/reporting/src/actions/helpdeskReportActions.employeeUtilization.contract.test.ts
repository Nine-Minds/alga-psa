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
    expect(section).toContain("scopedDb.table('user_work_schedules')");

    // No raw un-scoped table access.
    expect(section).not.toContain("knex('users')");
    expect(section).not.toContain("knex('time_entries')");
    expect(section).not.toContain("knex('resources')");
    expect(section).not.toContain("knex('user_work_schedules')");
  });

  it('takes capacity from the work schedule, never from booking availability', () => {
    const section = employeeUtilizationSection();

    // availability_settings answers "when may a client book this person", which
    // is not the same question as "when are they on the clock".
    expect(section).not.toContain('availability_settings');
    expect(section).not.toContain('availability_exceptions');
    expect(section).toContain('workSchedule: scheduleByUser.get(row.user_id)');
  });

  it('anchors the capacity window to the database date, not the app clock', () => {
    const section = employeeUtilizationSection();

    expect(section).toContain('SELECT CURRENT_DATE::text AS today');
    expect(section).toContain('buildEmployeeUtilizationReport(inputRows, rangeDays, rangeEndDate)');
  });

  it('restricts the roster to active internal users and windows time entries by calendar day', () => {
    const section = employeeUtilizationSection();

    expect(section).toContain("where('user_type', 'internal')");
    expect(section).toContain("where('is_inactive', false)");
    // Explicit work_date boundaries, so the numerator covers exactly the
    // rangeDays calendar days the capacity denominator is prorated over.
    expect(section).toContain("where('work_date', '>=', knex.raw(`CURRENT_DATE - INTERVAL '${rangeDays - 1} days'`))");
    expect(section).toContain("where('work_date', '<=', knex.raw('CURRENT_DATE'))");
    expect(section).not.toContain("where('start_time'");
  });

  it('reads one capacity row per user rather than aggregating duplicates', () => {
    const section = employeeUtilizationSection();

    expect(section).toContain("scopedDb.table('resources').select('user_id', 'max_weekly_capacity')");
    expect(section).not.toContain('MAX(max_weekly_capacity)');
  });

  it('delegates utilization math to the pure builder', () => {
    const section = employeeUtilizationSection();
    expect(section).toContain('return buildEmployeeUtilizationReport(inputRows, rangeDays, rangeEndDate);');
  });
});
