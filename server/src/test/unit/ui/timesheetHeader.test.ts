import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('timesheet header (static)', () => {
  it('shows subject identity and optional delegated actor line', () => {
    const src = readRepoFile(
      'packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetHeader.tsx'
    );
    expect(src).toContain('Time Sheet for');
    expect(src).toContain('Edited by');
  });
});

