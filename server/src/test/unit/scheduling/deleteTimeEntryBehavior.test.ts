import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('deleteTimeEntry behavior (static)', () => {
  it('blocks deletes for invoiced time entries', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeEntryCrudActions.ts');
    expect(src).toContain('already been invoiced and cannot be deleted');
  });
});

