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

describe('activity aggregation helper tenant-scoped query contract', () => {
  it('uses structural tenant scoping for helper client filters and target-user validation', () => {
    const filterSection = sectionBetween('async function filterScheduleEntriesByClient', 'async function resolveActivityTarget');
    const targetSection = sectionBetween('async function resolveActivityTarget', '/**\n * Fetch all activities');

    expect(filterSection).toContain("table: 'tickets'");
    expect(filterSection).toContain("table: 'project_tasks'");
    expect(targetSection).toContain("table: 'users'");

    expect(filterSection).not.toMatch(/knex\('tickets'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(filterSection).not.toContain(".where('project_tasks.tenant', tenant)");
    expect(targetSection).not.toMatch(/knex\('users'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });
});
