import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('timesheet approval behavior (static)', () => {
  it('approveTimeSheet enforces delegation and marks timesheet APPROVED', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeSheetActions.ts');
    expect(src).toMatch(/export const approveTimeSheet[\\s\\S]*assertCanActOnBehalf/);
    expect(src).toMatch(/approveTimeSheet[\\s\\S]*approval_status:\\s*'APPROVED'/);
  });

  it('bulkApproveTimeSheets enforces manager scope via assertCanActOnBehalf', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeSheetActions.ts');
    expect(src).toMatch(/export const bulkApproveTimeSheets[\\s\\S]*assertCanActOnBehalf/);
    expect(src).toMatch(/managerId\\s*!==\\s*user\\.user_id/);
  });
});
