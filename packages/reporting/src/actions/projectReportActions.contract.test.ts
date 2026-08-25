import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./projectReportActions.ts', import.meta.url), 'utf8');

function projectHoursSection(): string {
  const start = source.indexOf('export const getProjectHoursReport');
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start);
}

describe('project hours report tenant-scoped query contract', () => {
  it('gates on report read permission and scopes every query through tenantDb', () => {
    const section = projectHoursSection();

    expect(section).toContain('await assertCanReadReports(user, knex)');
    expect(section).toContain('const scopedDb = tenantDb(knex, tenant);');

    expect(section).toContain("scopedDb.table('projects as p')");
    expect(section).toContain("scopedDb.table('project_phases as ph')");
    expect(section).toContain("scopedDb.table('project_tasks as t')");

    // No raw un-scoped table access.
    expect(section).not.toContain("knex('projects')");
    expect(section).not.toContain("knex('project_phases')");
    expect(section).not.toContain("knex('project_tasks')");
    expect(section).not.toContain("knex('clients')");
  });

  it('joins clients, phases, tasks and both status tables through tenantJoin', () => {
    const section = projectHoursSection();

    expect(section).toContain("scopedDb.tenantJoin(projectQuery, 'clients as c', 'p.client_id', 'c.client_id', { type: 'left' })");
    expect(section).toContain("scopedDb.tenantJoin(projectQuery, 'project_phases as ph', 'p.project_id', 'ph.project_id', { type: 'left' })");
    expect(section).toContain("scopedDb.tenantJoin(projectQuery, 'project_tasks as t', 'ph.phase_id', 't.phase_id', { type: 'left' })");
    expect(section).toContain("'project_status_mappings as psm'");
    expect(section).toContain("'statuses as s'");
    expect(section).toContain("'standard_statuses as ss'");
  });

  it('resolves closed tasks from either the tenant or the standard status table', () => {
    const section = projectHoursSection();

    // A seeded mapping only carries standard_status_id, so consulting
    // `statuses` alone would report every seeded task as still open.
    expect(section).toContain("const closedExpression = 'COALESCE(s.is_closed, ss.is_closed, false)';");
    expect(section).toContain('SUM(CASE WHEN ${closedExpression} THEN 1 ELSE 0 END)::int as closed_tasks');
  });

  it('keeps hours in minutes until the edge and only reports active projects', () => {
    const section = projectHoursSection();

    expect(section).toContain("where('p.is_inactive', false)");
    expect(section).toContain("const estimatedMinutes = 'COALESCE(t.estimated_hours, 0)';");
    expect(section).toContain("const actualMinutes = 'COALESCE(t.actual_hours, 0)';");
    expect(section).toContain('budgetedHours = minutesToHours(row.budgeted_minutes)');
    expect(section).toContain('estimatedHours = minutesToHours(row.estimated_minutes)');
    expect(section).toContain('actualHours = minutesToHours(row.actual_minutes)');
  });

  it('summarises across every active project but only details the top rows', () => {
    const section = projectHoursSection();

    // The summary counts come from the full result set; the row limit is
    // applied afterwards so the totals are not silently truncated.
    expect(section).toContain('projects: projects.length,');
    expect(section).toContain('const topProjects = projects.slice(0, PROJECT_ROW_LIMIT);');
    expect(section.indexOf('const summary = {')).toBeLessThan(section.indexOf('const topProjects ='));
    expect(section).toContain('.limit(OVERRUN_ROW_LIMIT)');
  });

  it('never divides by a zero estimate or budget', () => {
    expect(source).toContain('function percentOf(numerator: number, denominator: number): number | null {');
    expect(source).toContain('if (denominator <= 0) return null;');
  });
});
