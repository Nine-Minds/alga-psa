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

describe('activity aggregation project status tenant-scoped query contract', () => {
  it('uses structural tenant scoping for project status filter subqueries', () => {
    const section = sectionBetween('export async function fetchProjectActivities', '// Client filter');

    expect(section).toContain("table: \"project_status_mappings\"");
    expect(section).toContain('alias: "psm"');

    expect(section).not.toContain('.from("project_status_mappings")');
    expect(section).not.toContain('.from({ psm: "project_status_mappings" })');
    expect(section).not.toContain('.where("project_status_mappings.tenant", tenant)');
    expect(section).not.toContain('.where("psm.tenant", tenant)');
  });
});
