import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('timesheet comments remain separate from entry-level feedback', () => {
  it('T027: employee timesheet view still renders sheet-level comments independently', () => {
    const source = readSource('../src/components/time-management/time-entry/time-sheet/TimeSheet.tsx');

    expect(source).toContain("import { TimeSheetComments } from '../../approvals/TimeSheetComments';");
    expect(source).toContain('<TimeSheetComments');
    expect(source).toContain('comments={comments}');
    expect(source).toContain('onAddComment={handleAddComment}');
  });

  it('T028: approval drawer keeps timesheet comments separate from entry-level change suggestions', () => {
    const source = readSource('../src/components/time-management/approvals/TimeSheetApproval.tsx');

    expect(source).toContain("const [newComment, setNewComment] = useState('');");
    expect(source).toContain("const [changeRequestComment, setChangeRequestComment] = useState('');");
    expect(source).toContain('await addCommentToTimeSheet(');
    expect(source).toContain('await updateTimeEntryApprovalStatus({');
  });
});
