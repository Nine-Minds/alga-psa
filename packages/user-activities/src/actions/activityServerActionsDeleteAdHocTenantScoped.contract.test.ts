import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'adHocActivityCore.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionFrom(startMarker: string): string {
  const start = source.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start);
}

describe('activity server delete ad-hoc tenant-scoped query contract', () => {
  it('uses structural tenant scoping for delete-ad-hoc lookup and deletes', () => {
    const section = sectionFrom('export async function deleteAdHocActivityForApi');

    expect(section).toContain(".table(\"schedule_entries");
    expect(section).toContain(".table(\"schedule_entry_assignees");

    expect(section).not.toMatch(/trx\("schedule_entries"\)\s*[\r\n]*\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/trx\("schedule_entry_assignees"\)\.where\(\{\s*tenant,/);
  });
});
