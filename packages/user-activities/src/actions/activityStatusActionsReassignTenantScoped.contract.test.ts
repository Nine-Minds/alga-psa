import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'activityStatusActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionFrom(startMarker: string): string {
  const start = source.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start);
}

describe('activity reassignment tenant-scoped query contract', () => {
  it('uses structural tenant scoping for reassignment roots', () => {
    const section = sectionFrom('export const reassignActivity');

    expect(section).toContain('const tenantScopedTable = (table: string) => tenantDb(trx, ');
    expect(section).toContain('tenantScopedTable("schedule_entries")');
    expect(section).toContain('tenantScopedTable("project_tasks")');
    expect(section).toContain('tenantScopedTable("tickets")');
    expect(section).toContain('tenantScopedTable("workflow_tasks")');

    expect(section).not.toMatch(/trx\("(schedule_entries|project_tasks|tickets|workflow_tasks)"\)\s*[\r\n]+\s*\.(?:where|update|first)/);
    expect(section).not.toContain('.where("tenant", tenant)');
  });
});
