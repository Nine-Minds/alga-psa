import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTimeSheetSource(): string {
  const filePath = path.resolve(
    __dirname,
    '../src/components/time-management/time-entry/time-sheet/TimeSheet.tsx'
  );

  return fs.readFileSync(filePath, 'utf8');
}

describe('TimeSheet multi-entry focus filter contract', () => {
  it('routes multi-entry grid cells into filtered list mode and wires clear/back controls', () => {
    const source = readTimeSheetSource();

    expect(source).toContain('if (selection.entries.length > 1)');
    expect(source).toContain("type: 'list-focus'");
    expect(source).toContain("setViewMode('list');");
    expect(source).toContain('focusFilter={listFocusFilter}');
    expect(source).toContain('onClearFocusFilter={handleClearListFocusFilter}');
    expect(source).toContain('onBackToGrid={handleBackToGrid}');
  });
});
