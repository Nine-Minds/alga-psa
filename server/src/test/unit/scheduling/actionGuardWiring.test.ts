import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('delegation guard wiring (static)', () => {
  it('fetchTimePeriods enforces delegation via assertCanActOnBehalf', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeSheetOperations.ts');
    expect(src).toContain('export const fetchTimePeriods');
    expect(src).toContain('assertCanActOnBehalf');
  });

  it('fetchOrCreateTimeSheet enforces delegation via assertCanActOnBehalf', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeSheetOperations.ts');
    expect(src).toContain('export const fetchOrCreateTimeSheet');
    expect(src).toContain('assertCanActOnBehalf');
  });

  it('fetchTimeSheet enforces owner-or-delegate access via assertCanActOnBehalf', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeSheetActions.ts');
    expect(src).toMatch(/export const fetchTimeSheet[\\s\\S]*assertCanActOnBehalf/);
  });

  it('fetchTimeEntriesForTimeSheet enforces owner-or-delegate access via assertCanActOnBehalf', () => {
    const srcActions = readRepoFile('packages/scheduling/src/actions/timeSheetActions.ts');
    expect(srcActions).toMatch(/export const fetchTimeEntriesForTimeSheet[\\s\\S]*assertCanActOnBehalf/);

    const srcCrud = readRepoFile('packages/scheduling/src/actions/timeEntryCrudActions.ts');
    expect(srcCrud).toMatch(/export const fetchTimeEntriesForTimeSheet[\\s\\S]*assertCanActOnBehalf/);
  });

  it('fetchWorkItemsForTimeSheet enforces owner-or-delegate access via assertCanActOnBehalf', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeEntryWorkItemActions.ts');
    expect(src).toMatch(/export const fetchWorkItemsForTimeSheet[\\s\\S]*assertCanActOnBehalf/);
  });
});
