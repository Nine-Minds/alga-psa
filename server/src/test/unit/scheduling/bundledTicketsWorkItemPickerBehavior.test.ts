import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('bundled ticket selection (static)', () => {
  it('exposes bundle metadata on picker results', () => {
    const src = readRepoFile('packages/scheduling/src/actions/workItemActions.ts');
    expect(src).toContain('export const searchPickerWorkItems');
    const pickerStart = src.indexOf('export const searchPickerWorkItems');
    expect(pickerStart).toBeGreaterThan(0);
    const pickerSrc = src.slice(pickerStart);

    expect(pickerSrc).toMatch(/master_ticket_id\s+as\s+master_ticket_id/);
    expect(pickerSrc).toMatch(/master_ticket_number/);
  });

  it('disables bundled tickets in the work item picker list with an explanation', () => {
    const src = readRepoFile(
      'packages/scheduling/src/components/time-management/time-entry/time-sheet/WorkItemList.tsx'
    );
    expect(src).toMatch(/item\.type\s*===\s*'ticket'\s*&&\s*!!item\.master_ticket_id/);
    expect(src).toContain('Bundled ticket — log time on the master ticket');
  });
});
