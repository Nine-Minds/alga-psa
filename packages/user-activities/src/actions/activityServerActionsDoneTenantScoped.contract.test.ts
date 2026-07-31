import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'adHocActivityCore.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('activity server mark done tenant-scoped query contract', () => {
  it('uses structural tenant scoping for ad-hoc assignee check and done updates', () => {
    const assigneeSection = sectionBetween(
      'async function assertCanModifyAdHoc',
      'export async function createAdHocActivityForApi'
    );
    const doneSection = sectionBetween(
      'export async function setAdHocActivityDoneForApi',
      'export async function deleteAdHocActivityForApi'
    );

    expect(assigneeSection).toContain(".table(\"schedule_entry_assignees");
    expect(doneSection).toContain(".table(\"schedule_entries");

    expect(assigneeSection).not.toMatch(/trx\("schedule_entry_assignees"\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(doneSection).not.toMatch(/trx\("schedule_entries"\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });
});
