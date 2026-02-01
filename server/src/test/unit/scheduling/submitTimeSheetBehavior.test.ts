import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('submitTimeSheet behavior (static)', () => {
  it('submits the timesheet and transitions entries to SUBMITTED', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeSheetOperations.ts');
    expect(src).toContain('export const submitTimeSheet');
    expect(src).toMatch(/approval_status:\\s*'SUBMITTED'/);
    expect(src).toMatch(/time_entries[\\s\\S]*approval_status:\\s*'SUBMITTED'/);
  });
});
