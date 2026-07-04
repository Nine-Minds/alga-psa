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

function sectionFrom(startMarker: string): string {
  const start = source.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start);
}

describe('activity group reorder tenant-scoped query contract', () => {
  it('uses structural tenant scoping for activity and group reorder roots', () => {
    const activitySection = sectionBetween('export const reorderActivitiesInGroup', 'export const reorderGroups');
    const groupSection = sectionFrom('export const reorderGroups');
    const section = `${activitySection}\n${groupSection}`;

    expect(section).toContain(".table('user_activity_groups");
    expect(section).toContain(".table('user_activity_group_items");

    expect(section).not.toMatch(/trx\('user_activity_groups'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/trx\('user_activity_group_items'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });
});
