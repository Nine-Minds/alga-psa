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

describe('activity server update ad-hoc tenant-scoped query contract', () => {
  it('uses structural tenant scoping for update-ad-hoc entry lookup and update', () => {
    const section = sectionBetween(
      'export async function updateAdHocActivityForApi',
      'export async function setAdHocActivityDoneForApi'
    );

    expect(section).toContain(".table(\"schedule_entries");

    expect(section).not.toMatch(/trx\("schedule_entries"\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toContain('trx("schedule_entries").where({ tenant, entry_id: entryId }).update(patch)');
  });
});
