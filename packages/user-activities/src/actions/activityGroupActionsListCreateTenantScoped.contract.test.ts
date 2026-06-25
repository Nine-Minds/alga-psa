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

describe('activity group list/create tenant-scoped query contract', () => {
  it('uses structural tenant scoping for list and create lookup roots', () => {
    const listSection = sectionBetween('export const getUserActivityGroups', 'export const createActivityGroup');
    const createSection = sectionBetween('export const createActivityGroup', 'export const updateActivityGroup');

    expect(listSection).toContain(".table('users");
    expect(listSection).toContain(".table('user_activity_groups");
    expect(listSection).toContain(".table('user_activity_group_items");
    expect(createSection).toContain(".table('user_activity_groups");
    expect(createSection).toContain("const [created] = await trx('user_activity_groups')");

    expect(listSection).not.toMatch(/trx\('users'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(listSection).not.toMatch(/trx\('user_activity_groups'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(listSection).not.toMatch(/trx\('user_activity_group_items'\)\s*[\r\n]+\s*\.where\(\{\s*tenant\s*\}\)/);
    expect(createSection).not.toMatch(/trx\('user_activity_groups'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });
});
