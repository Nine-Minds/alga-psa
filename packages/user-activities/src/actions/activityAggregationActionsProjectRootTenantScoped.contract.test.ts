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

describe('activity aggregation project root tenant-scoped query contract', () => {
  it('uses structural tenant scoping for the project task activity root', () => {
    const section = sectionBetween('export async function fetchProjectActivities', '/**\n * Fetch ticket activities');

    expect(section).toContain(".table(\"project_tasks");
    expect(section).toContain('.select(');
    expect(section).toContain('this.orWhereExists(');

    expect(section).not.toContain('return await trx("project_tasks")');
    expect(section).not.toContain('.where("project_tasks.tenant", tenant)');
  });
});
