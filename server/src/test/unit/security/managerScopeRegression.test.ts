import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('manager scope regression (static)', () => {
  it('does not accept client-supplied teamIds for approval dashboard queries', () => {
    const actions = readRepoFile('packages/scheduling/src/actions/timeSheetActions.ts');
    expect(actions).toContain('export const fetchTimeSheetsForApproval');
    expect(actions).not.toMatch(/fetchTimeSheetsForApproval[\\s\\S]*teamIds/);

    const dashboard = readRepoFile(
      'packages/scheduling/src/components/time-management/approvals/ManagerApprovalDashboard.tsx'
    );
    expect(dashboard).toContain('fetchTimeSheetsForApproval(showApproved)');
    expect(dashboard).not.toContain('managedTeams.map');
  });
});

