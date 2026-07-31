import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Move/remove mutations live in the identity-explicit core (shared with the
// v1 REST API); the withAuth actions only delegate.
const sourcePath = resolve(__dirname, 'activityGroupCore.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('activity group move/remove tenant-scoped query contract', () => {
  it('uses structural tenant scoping for move/remove lookup and mutation roots', () => {
    const section = sectionBetween(
      'export async function moveActivityToGroupForApi',
      'export async function reorderActivitiesInGroupForApi'
    );

    expect(section).toContain('.table("user_activity_groups');
    expect(section).toContain('.table("user_activity_group_items');
    expect(section).toContain('await scopedDb.table("user_activity_group_items").insert({');

    expect(section).not.toMatch(/trx\("user_activity_groups"\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/trx\("user_activity_group_items"\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });
});
