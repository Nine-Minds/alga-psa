import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('submitTimeSheet behavior (static)', () => {
  it('submits the timesheet and transitions entries to SUBMITTED', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeSheetOperations.ts');
    expect(src).toContain('export const submitTimeSheet');
    expect(src).toMatch(/export const submitTimeSheet[\s\S]*operation: 'submit'/);
    // The lifecycle engine owns the transition: sheet and every entry move to SUBMITTED together.
    const engine = readRepoFile('packages/scheduling/src/lib/timeSheetApprovalTransition.ts');
    expect(engine).toMatch(/submit: \{[\s\S]*?entries: 'all',\s*entryStatus: 'SUBMITTED'/);
    expect(engine).toMatch(/submit: \{[\s\S]*?approval_status: 'SUBMITTED'/);
  });
});
