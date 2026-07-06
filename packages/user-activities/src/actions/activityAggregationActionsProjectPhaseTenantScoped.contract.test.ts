import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'activityAggregationActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('activity aggregation project phase tenant-scoped query contract', () => {
  it('uses structural tenant scoping for project phase filter subqueries', () => {
    const section = sectionBetween('// Apply project and phase filters with OR semantics', '// Exclude tasks in the excluded phases');

    expect(section).toContain(".table(\"project_phases");
    expect(section).toContain('.whereRaw("project_phases.phase_id = project_tasks.phase_id")');

    expect(section).not.toContain('.from("project_phases")');
    expect(section).not.toContain('.andWhere("project_phases.tenant", tenant)');
  });
});
