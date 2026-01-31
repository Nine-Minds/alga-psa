import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('reopen for edits (static)', () => {
  it('is gated server-side on permission, delegation, and invoiced entries', () => {
    const src = readRepoFile('server/src/app/msp/time-entry/timesheet/[id]/page.tsx');
    expect(src).toContain('canReopenForEdits');
    expect(src).toContain("timeSheet.approval_status === 'APPROVED'");
    expect(src).toContain("hasPermission(currentUser, 'timesheet', 'reverse'");
    expect(src).toContain('hasInvoicedEntries');
    expect(src).toContain('assertCanActOnBehalf');
  });

  it('renders the button only when allowed and uses reverseTimeSheetApproval on confirm', () => {
    const header = readRepoFile(
      'packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetHeader.tsx'
    );
    expect(header).toContain('canReopenForEdits');
    expect(header).toContain('Reopen for edits');

    const client = readRepoFile(
      'packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetClient.tsx'
    );
    expect(client).toContain('ConfirmationDialog');
    expect(client).toContain('reverseTimeSheetApproval');
  });
});

