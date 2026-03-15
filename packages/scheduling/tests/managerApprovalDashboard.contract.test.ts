import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('ManagerApprovalDashboard approval drawer data contract', () => {
  it('uses the enriched time-entry fetcher when opening the approval drawer', () => {
    const source = readSource('../src/components/time-management/approvals/ManagerApprovalDashboard.tsx');

    expect(source).toContain("import { fetchTimeEntriesForTimeSheet } from '../../../actions/timeEntryActions';");
    expect(source).not.toContain("fetchTimeEntriesForTimeSheet,\n  approveTimeSheet,");
    expect(source).toContain('fetchTimeEntriesForTimeSheet(timeSheet.id),');
  });
});
