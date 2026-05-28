import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const tableSource = readFileSync(resolve(__dirname, './TimeSheetTable.tsx'), 'utf8');
const listSource = readFileSync(resolve(__dirname, './TimeSheetListView.tsx'), 'utf8');
const sheetSource = readFileSync(resolve(__dirname, './TimeSheet.tsx'), 'utf8');
const approvalSource = readFileSync(
  resolve(__dirname, '../../approvals/TimeSheetApproval.tsx'),
  'utf8',
);

describe('work-date wiring for time sheet and approvals', () => {
  it('T004: time sheet grid uses work-date helper for per-cell and footer daily grouping', () => {
    expect(tableSource).toContain('isTimeEntryOnWorkDate(entry, dateKey)');
  });

  it('T005: time sheet list groups, filters, and renders headers using the resolved work-date key', () => {
    expect(listSource).toContain('const entryWorkDate = getTimeEntryWorkDate(entry);');
    expect(listSource).toContain('date: parseISO(entryWorkDate)');
    expect(listSource).toContain('dateKey: entryWorkDate');
  });

  it('T006: approval daily breakdown and row date display use resolved work-date', () => {
    expect(approvalSource).toContain('const date = getTimeEntryWorkDate(entry);');
    expect(approvalSource).toContain('parseISO(getTimeEntryWorkDate(entry))');
  });

  it('T007: quick-add continuation filters existing entries by resolved work-date', () => {
    expect(sheetSource).toContain('return getTimeEntryWorkDate(entry) === workDate;');
  });
});
