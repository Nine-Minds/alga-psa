import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('add work item dialog focus-selection wiring', () => {
  it('threads the focused work item into the add-item picker and highlights it', () => {
    const timeSheetSource = readSource('../src/components/time-management/time-entry/time-sheet/TimeSheet.tsx');
    const dialogSource = readSource('../src/components/time-management/time-entry/time-sheet/AddWorkItemDialog.tsx');
    const pickerSource = readSource('../src/components/time-management/time-entry/time-sheet/WorkItemPicker.tsx');
    const listSource = readSource('../src/components/time-management/time-entry/time-sheet/WorkItemList.tsx');

    expect(timeSheetSource).toContain('const [persistedListFocusFilter, setPersistedListFocusFilter] = useState<TimeSheetListFocusFilter | null>(null);');
    expect(timeSheetSource).toContain('const listFocusFilter = persistedListFocusFilter;');
    expect(timeSheetSource).toContain('setPersistedListFocusFilter(nextFilter);');
    expect(timeSheetSource).toContain('initialWorkItemId={listFocusFilter?.workItemId ?? null}');
    expect(dialogSource).toContain('initialWorkItemId={initialWorkItemId}');
    expect(pickerSource).toContain('const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(initialWorkItemId ?? null);');
    expect(pickerSource).toContain('pinnedItem={initialWorkItem}');
    expect(pickerSource).toContain('selectedWorkItemId={selectedWorkItemId}');
    expect(listSource).toContain('id="current-work-item-option"');
    expect(listSource).toContain("defaultValue: 'Current work item'");
    expect(listSource).toContain("item.title || item.name || t('common.fallbacks.untitled'");
    expect(listSource).toContain("item.task_name || item.name || t('common.fallbacks.untitled'");
  });
});
