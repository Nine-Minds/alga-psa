import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, relativePath), 'utf8');

describe('time/delegation narrowing sweep contracts', () => {
  const delegationSource = readSource('../src/actions/timeEntryDelegationAuth.ts');
  const timeSheetSource = readSource('../src/actions/timeSheetActions.ts');

  it('T024: delegation guards keep time_entry kernel semantics and do not allow approve/read_all bypasses', () => {
    expect(delegationSource).toContain("type: 'time_entry'");
    expect(delegationSource).toContain("action: 'read'");
    expect(delegationSource).toContain("action: 'approve'");
    expect(delegationSource).toContain('function buildTimesheetNotSelfApproverGuard(');
    expect(delegationSource).toContain("code: 'timesheet_not_self_approver_denied'");
    expect(delegationSource).toContain('const managedUserIds = canReadAll ? [] : await resolveManagedSubjectUserIds(db, tenant, actor);');
    expect(delegationSource).toContain("throw new Error('Permission denied: Cannot access other users time sheets')");
  });

  it('T024: time sheet approval/comment/change flows enforce delegation checks against target subject ownership', () => {
    expect(timeSheetSource).toContain('export const addCommentToTimeSheet = withAuth(async');
    expect(timeSheetSource).toContain('if (!isOwner) {');
    expect(timeSheetSource).toContain('await assertCanActOnBehalf(user, tenant, timeSheet.user_id, db);');
    expect(timeSheetSource).toContain('export const requestChangesForTimeSheet = withAuth(async');
    expect(timeSheetSource).toContain('await assertCanActOnBehalf(user, tenant, timeSheet.user_id, trx);');
    expect(timeSheetSource).toContain('export const approveTimeSheet = withAuth(async');
    expect(timeSheetSource).toContain('await assertCanApproveSubject(user, tenant, timeSheet.user_id, trx);');
    expect(timeSheetSource).toContain('export const reverseTimeSheetApproval = withAuth(async');
    expect(timeSheetSource).toContain('await assertCanActOnBehalf(user, tenant, timeSheet.user_id, trx);');
  });
});
