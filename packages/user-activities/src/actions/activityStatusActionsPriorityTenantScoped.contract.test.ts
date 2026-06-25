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

describe('activity priority tenant-scoped query contract', () => {
  it('uses structural tenant scoping for priority update roots', () => {
    const section = sectionBetween('export const updateActivityPriority', 'export const reassignActivity');

    expect(section).toContain('const tenantScopedTable = (table: string) => tenantDb(trx, ');
    expect(section).toContain('tenantScopedTable("priorities")');
    expect(section).toContain('tenantScopedTable("tickets")');
    expect(section).toContain('tenantScopedTable("project_tasks")');
    expect(section).toContain('tenantScopedTable("workflow_tasks")');

    expect(section).not.toMatch(/trx\("(priorities|tickets|project_tasks|workflow_tasks)"\)\s*[\r\n]+\s*\.(?:where|update)/);
    expect(section).not.toContain('.where("tenant", tenant)');
  });
});
