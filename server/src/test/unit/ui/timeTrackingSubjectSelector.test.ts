import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('/msp/time-entry subject selector (static)', () => {
  it('defaults to self and hides selector when only one eligible subject exists', () => {
    const src = readRepoFile(
      'packages/scheduling/src/components/time-management/time-entry/TimeTracking.tsx'
    );
    expect(src).toContain('useState(currentUser.user_id)');
    expect(src).toContain('const showSubjectSelector = subjectUsers.length > 1');
  });

  it('uses UserPicker populated from eligible-subjects server action', () => {
    const src = readRepoFile(
      'packages/scheduling/src/components/time-management/time-entry/TimeTracking.tsx'
    );
    expect(src).toContain("import UserPicker from '@alga-psa/ui/components/UserPicker'");
    expect(src).toContain('fetchEligibleTimeEntrySubjects');
    expect(src).toContain('users={subjectUsers}');
  });
});
