import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTimeSheetListViewSource(): string {
  const filePath = path.resolve(
    __dirname,
    '../src/components/time-management/time-entry/time-sheet/TimeSheetListView.tsx'
  );

  return fs.readFileSync(filePath, 'utf8');
}

describe('TimeSheetListView row interaction contract', () => {
  it('keeps row clicks for editing and reserves the trailing action button for work item details', () => {
    const source = readTimeSheetListViewSource();

    expect(source).toContain('onClick={() => handleEntryClick(flatEntry)}');
    expect(source).toContain('className="text-sm text-gray-900 truncate"');

    expect(source).toContain('id={`view-work-item-${entry.entry_id}`}');
    expect(source).toContain('onWorkItemClick(workItem);');
    expect(source).toContain('title="View details"');
    expect(source).toContain('<ExternalLink className="h-4 w-4" />');
  });
});
