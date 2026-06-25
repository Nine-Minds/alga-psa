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

describe('activity aggregation time-entry root tenant-scoped query contract', () => {
  it('uses structural tenant scoping for the time-entry activity root', () => {
    const section = sectionBetween('export async function fetchTimeEntryActivities', '/**\n * Fetch notification activities');

    expect(section).toContain("table: \"time_entries\"");
    expect(section).toContain('.where("time_entries.user_id", userId)');

    expect(section).not.toContain('return await trx("time_entries")');
    expect(section).not.toContain('.where("time_entries.tenant", tenant)');
  });
});
