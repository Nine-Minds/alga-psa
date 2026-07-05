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

describe('activity aggregation ticket tag tenant-scoped query contract', () => {
  it('uses structural tenant scoping for ticket tag filter subquery', () => {
    const section = sectionBetween('// Tag filter: ticket must have at least one of the requested tags', '// Text search filter');

    expect(section).toContain(".table(\"tag_mappings");
    expect(section).toContain('.whereRaw("tag_mappings.tagged_id = tickets.ticket_id::text")');

    expect(section).not.toContain('.from("tag_mappings")');
    expect(section).not.toContain('.andWhere("tag_mappings.tenant", tenant)');
  });
});
