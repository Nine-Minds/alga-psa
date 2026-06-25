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

describe('activity aggregation ticket root tenant-scoped query contract', () => {
  it('uses structural tenant scoping for the ticket activity root', () => {
    const section = sectionBetween('export async function fetchTicketActivities', '/**\n * Fetch time entry activities');

    expect(section).toContain("table: \"tickets\"");
    expect(section).toContain('.select(');
    expect(section).toContain('.orWhereExists(function()');

    expect(section).not.toContain('return await trx("tickets")');
    expect(section).not.toContain('.where("tickets.tenant", tenant)');
  });
});
