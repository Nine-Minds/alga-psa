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

describe('activity aggregation ad-hoc helper tenant-scoped query contract', () => {
  it('uses structural tenant scoping for ad-hoc schedule entry and assignee roots', () => {
    const section = sectionBetween('async function fetchAdHocEntriesForUser', '/**\n * Fetch schedule activities');

    expect(section).toContain("table: 'schedule_entries'");
    expect(section).toContain("alias: 'se'");
    expect(section).toContain("table: 'schedule_entry_assignees'");

    expect(section).not.toContain("knex('schedule_entries as se')");
    expect(section).not.toContain(".where('se.tenant', tenant)");
    expect(section).not.toContain("knex('schedule_entry_assignees')");
    expect(section).not.toContain(".where('tenant', tenant)");
  });
});
