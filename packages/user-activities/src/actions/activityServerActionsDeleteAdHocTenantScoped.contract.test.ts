import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'activityServerActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('activity server delete ad-hoc tenant-scoped query contract', () => {
  it('uses structural tenant scoping for delete-ad-hoc lookup and deletes', () => {
    const section = sectionBetween('export const deleteAdHocActivity', 'export interface ActivityViewableUsersResult');

    expect(section).toContain(".table(\"schedule_entries");
    expect(section).toContain(".table(\"schedule_entry_assignees");

    expect(section).not.toMatch(/trx\("schedule_entries"\)\s*[\r\n]*\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/trx\("schedule_entry_assignees"\)\.where\(\{\s*tenant,/);
  });
});
