import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'activityServerActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionFrom(startMarker: string): string {
  const start = source.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start);
}

describe('activity server viewable users tenant-scoped query contract', () => {
  it('uses structural tenant scoping for viewable-user list root', () => {
    const section = sectionFrom('export const getActivityViewableUsers');

    expect(section).toContain("table: \"users\"");
    expect(section).toContain('.where({ user_type: "internal", is_inactive: false })');

    expect(section).not.toMatch(/knex\("users"\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });
});
