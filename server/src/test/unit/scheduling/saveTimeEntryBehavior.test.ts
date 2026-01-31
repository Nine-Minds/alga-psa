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
});
