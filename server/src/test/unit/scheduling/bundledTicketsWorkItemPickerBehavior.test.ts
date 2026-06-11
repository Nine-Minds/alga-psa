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

  it('renders bundled tickets as selectable with an informational badge', () => {
    const src = readRepoFile(
      'packages/scheduling/src/components/time-management/time-entry/time-sheet/WorkItemList.tsx'
    );
    // Bundled children stay selectable — no disable gating in the list.
    expect(src).not.toContain('aria-disabled');
    expect(src).not.toContain('Bundled ticket — log time on the master ticket');
    // An informational badge points at the master instead.
    expect(src).toMatch(/workItemList\.bundledUnder/);
    expect(src).toContain('Bundled → {{number}}');
  });
});
