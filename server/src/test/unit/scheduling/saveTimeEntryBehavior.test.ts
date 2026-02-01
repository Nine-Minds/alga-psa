import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('saveTimeEntry behavior (static)', () => {
  it('persists user_id from the subject (not always actor)', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeEntryCrudActions.ts');
    expect(src).toContain('let timeEntryUserId = validatedTimeEntry.user_id');
    expect(src).toContain('user_id: timeEntryUserId');
  });

  it('does not change user_id ownership on update', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeEntryCrudActions.ts');
    expect(src).toContain('const { tenant: _tenant, user_id: _user_id, ...updateData } = cleanedEntry');
  });

  it('sets created_by/updated_by audit fields from the actor', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeEntryCrudActions.ts');
    expect(src).toContain('updated_by: actorUserId');
    expect(src).toContain('created_by: actorUserId');
  });

  it('rejects time entries outside the timesheet time period boundaries', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeEntryCrudActions.ts');
    expect(src).toContain('Time entry must fall within the time period for the time sheet');
    expect(src).toContain('const periodStart');
    expect(src).toContain('const periodEnd');
  });

  it('blocks updates to invoiced time entries', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeEntryCrudActions.ts');
    expect(src).toContain('already been invoiced and cannot be modified');
  });
});
