import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'activityAggregationActions.ts'), 'utf8');
// The assignment predicate is shared with the detail-screen eligibility check, so the
// structural tenant-scoping contract now applies to the shared module.
const scopeSource = readFileSync(resolve(__dirname, 'activityAssignmentScope.ts'), 'utf8');

function sectionBetween(text: string, startMarker: string, endMarker?: string): string {
  const start = text.indexOf(startMarker);
  const end = endMarker === undefined ? text.length : text.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return text.slice(start, end);
}

describe('activity aggregation project assignment tenant-scoped query contract', () => {
  it('uses structural tenant scoping for task_resources assignment subquery', () => {
    const section = sectionBetween(source, 'export async function fetchProjectActivities', '// Apply filters');
    const scopeSection = sectionBetween(scopeSource, 'export function whereProjectTaskOnUsersList');

    expect(section).toContain('.where(whereProjectTaskOnUsersList(scopedDb, db, userId))');

    expect(scopeSection).toContain(".table(\"task_resources");
    expect(scopeSection).toContain('.whereRaw("task_resources.task_id = project_tasks.task_id")');

    expect(scopeSection).not.toContain('.from("task_resources")');
    expect(scopeSection).not.toContain('.andWhere("task_resources.tenant", tenant)');
  });
});
