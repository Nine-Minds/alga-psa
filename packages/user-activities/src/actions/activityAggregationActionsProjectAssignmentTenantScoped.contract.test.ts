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

describe('activity aggregation project assignment tenant-scoped query contract', () => {
  it('uses structural tenant scoping for task-resource assignment subquery', () => {
    const section = sectionBetween('export async function fetchProjectActivities', '// Apply filters');

    expect(section).toContain("table: \"task_resources\"");
    expect(section).toContain('.whereRaw("task_resources.task_id = project_tasks.task_id")');

    expect(section).not.toContain('.from("task_resources")');
    expect(section).not.toContain('.andWhere("task_resources.tenant", tenant)');
  });
});
