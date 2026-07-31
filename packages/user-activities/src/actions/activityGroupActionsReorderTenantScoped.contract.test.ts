import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Item reorder lives in the identity-explicit core (shared with the v1 REST
// API); group reorder remains an inline withAuth action.
const coreSource = readFileSync(resolve(__dirname, 'activityGroupCore.ts'), 'utf8');
const actionsSource = readFileSync(resolve(__dirname, 'activityGroupActions.ts'), 'utf8');

function sectionFrom(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start);
}

describe('activity group reorder tenant-scoped query contract', () => {
  it('uses structural tenant scoping for activity and group reorder roots', () => {
    const activitySection = sectionFrom(coreSource, 'export async function reorderActivitiesInGroupForApi');
    const groupSection = sectionFrom(actionsSource, 'export const reorderGroups');

    expect(activitySection).toContain('.table("user_activity_groups');
    expect(activitySection).toContain('.table("user_activity_group_items');
    expect(groupSection).toContain(".table('user_activity_groups");

    expect(activitySection).not.toMatch(/trx\("user_activity_groups"\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(activitySection).not.toMatch(/trx\("user_activity_group_items"\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(groupSection).not.toMatch(/trx\('user_activity_groups'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });
});
