import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readDialogSource(): string {
  const filePath = path.resolve(
    __dirname,
    '../src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx'
  );

  return fs.readFileSync(filePath, 'utf8');
}

describe('TimeEntryDialog single-entry contract', () => {
  it('removes the multi-entry dialog flow and keeps a single-entry form', () => {
    const source = readDialogSource();

    expect(source).toContain('SingleTimeEntryForm');
    expect(source).not.toContain('TimeEntryList');
    expect(source).not.toContain('handleAddEntry');
    expect(source).not.toContain('Edit Time Entries for');
    expect(source).toContain("Time Entry for ${workItem.name}");
    expect(source).not.toContain('add-new-entry-btn');
  });
});
