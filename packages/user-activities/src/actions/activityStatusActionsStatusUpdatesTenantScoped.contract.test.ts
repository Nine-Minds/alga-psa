import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'activityStatusActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('activity status update tenant-scoped query contract', () => {
  it('uses structural tenant scoping for status update roots', () => {
    const section = sectionBetween('export const updateActivityStatus', 'export const getActivityStatusOptions');

    expect(section).toContain('const tenantScopedTable = (table: string) => createTenantScopedQuery(trx, {');
    expect(section).toContain('tenantScopedTable("schedule_entries")');
    expect(section).toContain('tenantScopedTable("project_status_mappings")');
    expect(section).toContain('tenantScopedTable("project_tasks")');
    expect(section).toContain('tenantScopedTable("statuses")');
    expect(section).toContain('tenantScopedTable("tickets")');
    expect(section).toContain('tenantScopedTable("time_entries")');
    expect(section).toContain('tenantScopedTable("workflow_tasks")');

    expect(section).not.toMatch(/trx\("(schedule_entries|project_status_mappings|project_tasks|statuses|tickets|time_entries|workflow_tasks)"\)\s*[\r\n]+\s*\.(?:where|join)/);
    expect(section).not.toContain('.where("tenant", tenant)');
    expect(section).not.toContain('.where("project_status_mappings.tenant", tenant)');
  });
});
