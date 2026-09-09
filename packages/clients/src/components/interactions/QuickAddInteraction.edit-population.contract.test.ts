/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(path.resolve(__dirname, './QuickAddInteraction.tsx'), 'utf8');
}

describe('quick add interaction edit population contract', () => {
  it('applies the edited type/status only after their option lists are loaded', () => {
    const source = readSource();

    const fetchDataStart = source.indexOf('const fetchData = async () => {');
    const populateStart = source.indexOf('if (isEditMode && editingInteraction) {', fetchDataStart);
    const setStatusesIndex = source.indexOf('setStatuses(statusList);');

    expect(fetchDataStart).toBeGreaterThan(-1);
    expect(setStatusesIndex).toBeGreaterThan(fetchDataStart);
    // A Radix select drops a controlled value whose option is not mounted yet, so the
    // assignment must come after both lists are in state.
    expect(populateStart).toBeGreaterThan(setStatusesIndex);
    expect(source.slice(populateStart, populateStart + 600)).toContain(
      "setTypeId(editingInteraction.type_id || '');",
    );
    expect(source.slice(populateStart, populateStart + 600)).toContain(
      "setStatusId(editingInteraction.status_id || '');",
    );
  });

  it('does not set the type/status while the option lists are still empty', () => {
    const source = readSource();

    expect(source).toContain('// type_id / status_id are set from fetchData, once their options exist.');
    expect(source.match(/setTypeId\(editingInteraction\.type_id/g)).toHaveLength(1);
    expect(source.match(/setStatusId\(editingInteraction\.status_id/g)).toHaveLength(1);
  });

  it('keeps a system interaction type selectable while editing', () => {
    const source = readSource();

    expect(source).toContain('const currentTypeId = editingInteraction?.type_id;');
    expect(source).toContain("if (currentTypeId && !options.some((option) => option.value === currentTypeId)) {");
    expect(source).toContain('options.unshift({');
  });
});
