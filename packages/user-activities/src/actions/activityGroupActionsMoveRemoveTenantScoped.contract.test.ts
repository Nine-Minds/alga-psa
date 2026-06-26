import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'activityGroupActions.ts');
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
    const section = sectionBetween('export const moveActivityToGroup', 'export const reorderActivitiesInGroup');

    expect(section).toContain(".table('user_activity_groups");
    expect(section).toContain(".table('user_activity_group_items");
    expect(section).toContain("await tenantDb(trx, tenant).table('user_activity_group_items').insert({");

    expect(section).not.toMatch(/trx\('user_activity_groups'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/trx\('user_activity_group_items'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });
});
