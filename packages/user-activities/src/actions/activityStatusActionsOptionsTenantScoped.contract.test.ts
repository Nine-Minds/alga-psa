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

describe('activity status options tenant-scoped query contract', () => {
  it('uses structural tenant scoping for ticket and project-task status option roots', () => {
    const section = sectionBetween('export const getActivityStatusOptions', 'export const updateActivityPriority');

    expect(section).toContain('const scopedDb = tenantDb(trx, tenant);');
    expect(section).toContain('const tenantScopedTable = (table: string) => scopedDb.table(table);');
    expect(section).toContain('tenantScopedTable("tickets")');
    expect(section).toContain('tenantScopedTable("statuses")');
    expect(section).toContain('tenantScopedTable("project_tasks")');
    expect(section).toContain('.table("project_status_mappings as psm');

    expect(section).not.toMatch(/trx\("(tickets|statuses|project_tasks)"\)\s*[\r\n]+\s*\.(?:where|leftJoin)/);
    expect(section).not.toContain('.where("tenant", tenant)');
    expect(section).not.toContain('.where("project_tasks.tenant", tenant)');
    expect(section).not.toContain('.where("psm.tenant", tenant)');
  });
});
