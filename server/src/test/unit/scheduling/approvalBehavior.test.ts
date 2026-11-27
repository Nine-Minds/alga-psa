import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('timesheet approval behavior (static)', () => {
  it('approveTimeSheet enforces approval authorization and marks timesheet APPROVED', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeSheetActions.ts');
    expect(src).toMatch(/export const approveTimeSheet[\s\S]*approveSubmittedTimeSheet\([\s\S]*sessionLifecycleActor\(user, tenant\)/);
    // The session actor applies the approval subject rule; the engine requires it and marks APPROVED.
    expect(readRepoFile('packages/scheduling/src/lib/timeSheetLifecycleActor.ts')).toContain('assertCanApproveSubject');
    const engine = readRepoFile('packages/scheduling/src/lib/timeSheetApprovalTransition.ts');
    expect(engine).toMatch(/approve: \{[\s\S]*?subject: 'approveSubject'/);
    expect(engine).toMatch(/approve: \{[\s\S]*?approval_status: 'APPROVED'/);
  });

  it('bulkApproveTimeSheets enforces approval authorization', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeSheetActions.ts');
    expect(src).toMatch(/export const bulkApproveTimeSheets[\s\S]*approveSubmittedTimeSheet\([\s\S]*sessionLifecycleActor\(user, tenant\)/);
    expect(src).toMatch(/managerId\s*!==\s*user\.user_id/);
  });
});
