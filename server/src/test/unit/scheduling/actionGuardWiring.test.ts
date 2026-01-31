import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('delegation guard wiring (static)', () => {
  it('fetchTimePeriods enforces delegation via assertCanActOnBehalf', () => {
    const src = readRepoFile('packages/scheduling/src/actions/timeSheetOperations.ts');
    expect(src).toContain('export const fetchTimePeriods');
    expect(src).toContain('assertCanActOnBehalf');
  });
});

