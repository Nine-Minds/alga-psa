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

describe('activity aggregation ticket assignment tenant-scoped query contract', () => {
  it('uses structural tenant scoping for ticket-resource assignment subquery', () => {
    const section = sectionBetween('export async function fetchTicketActivities', '// Apply filters');

    expect(section).toContain(".table(\"ticket_resources");
    expect(section).toContain('.whereRaw("ticket_resources.ticket_id = tickets.ticket_id")');

    expect(section).not.toContain('.from("ticket_resources")');
    expect(section).not.toContain('.andWhere("ticket_resources.tenant", tenant)');
  });
});
