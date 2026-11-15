import { describe, expect, it } from 'vitest';
import {
  buildTryItValues,
  canRedo,
  canUndo,
  createFormBuilderState,
  deleteElement,
  duplicateElement,
  getDocument,
  insertElement,
  moveElement,
  nudgeElement,
  redo,
  renameElementKey,
  replaceDocument,
  selectElement,
  slugifyElementKey,
  undo,
  uniqueElementKey,
  updateElement,
  updateSettings,
  type FormBuilderDocument,
} from '../../../../../app/msp/service-requests/form-builder/formBuilderState';

const baseDocument = (): FormBuilderDocument => ({
  elements: [
    { key: 'employee', type: 'section', label: 'Employee' },
    { key: 'full_name', type: 'short-text', label: 'Full name', required: true },
    { key: 'start_date', type: 'date', label: 'Start date' },
  ],
  settings: {},
});

const keys = (state: ReturnType<typeof createFormBuilderState>) =>
  getDocument(state).elements.map((element) => element.key);

describe('form builder keys', () => {
  it('slugs a label into a key the schema validator accepts', () => {
    expect(slugifyElementKey('Needs a laptop?')).toBe('needs_a_laptop');
    expect(slugifyElementKey('  ')).toBe('field');
    expect(slugifyElementKey('2026 budget')).toBe('field_2026_budget');
  });

  it('suffixes a key that is already taken', () => {
    const taken = new Set(['full_name', 'full_name_2']);
    expect(uniqueElementKey('Full name', taken)).toBe('full_name_3');
    expect(uniqueElementKey('Start date', taken)).toBe('start_date');
  });
});

describe('form builder edits', () => {
  it('inserts at a position, selects what it inserted, and keeps keys unique', () => {
    let state = createFormBuilderState(baseDocument());
    state = insertElement(state, { type: 'short-text', label: 'Full name' }, 1);

    expect(keys(state)).toEqual(['employee', 'full_name_2', 'full_name', 'start_date']);
    expect(state.selectedKey).toBe('full_name_2');
  });

  it('clamps an out-of-range insert index to the end', () => {
    let state = createFormBuilderState(baseDocument());
    state = insertElement(state, { type: 'divider', label: '' }, 99);
    expect(keys(state)[3]).toBe('divider');
  });

  it('moves an element and nudges it one slot at a time', () => {
    let state = createFormBuilderState(baseDocument());
    state = moveElement(state, 'start_date', 1);
    expect(keys(state)).toEqual(['employee', 'start_date', 'full_name']);

    state = nudgeElement(state, 'start_date', -1);
    expect(keys(state)).toEqual(['start_date', 'employee', 'full_name']);
    // Already at the top: nothing moves.
    expect(keys(nudgeElement(state, 'start_date', -1))).toEqual(keys(state));
  });

  it('duplicates an element right after itself with a fresh key', () => {
    let state = createFormBuilderState(baseDocument());
    state = duplicateElement(state, 'full_name');

    expect(keys(state)).toEqual(['employee', 'full_name', 'full_name_2', 'start_date']);
    expect(getDocument(state).elements[2]).toMatchObject({ label: 'Full name', required: true });
    expect(state.selectedKey).toBe('full_name_2');
  });

  it('deletes an element and selects the one that took its place', () => {
    let state = createFormBuilderState(baseDocument());
    state = deleteElement(state, 'full_name');

    expect(keys(state)).toEqual(['employee', 'start_date']);
    expect(state.selectedKey).toBe('start_date');
  });

  it('renames a key in place, and refuses an empty or taken one', () => {
    let state = createFormBuilderState(baseDocument());
    state = renameElementKey(state, 'full_name', 'Employee name');
    expect(keys(state)).toEqual(['employee', 'employee_name', 'start_date']);
    expect(state.selectedKey).toBe('employee_name');

    const unchanged = renameElementKey(state, 'employee_name', 'start_date');
    expect(unchanged).toBe(state);
  });
});

describe('undo and redo', () => {
  it('walks back and forward through the edits', () => {
    let state = createFormBuilderState(baseDocument());
    expect(canUndo(state)).toBe(false);

    state = insertElement(state, { type: 'checkbox', label: 'Needs a laptop' });
    state = deleteElement(state, 'start_date');
    expect(keys(state)).toEqual(['employee', 'full_name', 'needs_a_laptop']);

    state = undo(state);
    expect(keys(state)).toEqual(['employee', 'full_name', 'start_date', 'needs_a_laptop']);
    state = undo(state);
    expect(keys(state)).toEqual(['employee', 'full_name', 'start_date']);
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(true);

    state = redo(state);
    expect(keys(state)).toEqual(['employee', 'full_name', 'start_date', 'needs_a_laptop']);
  });

  it('merges consecutive edits of the same thing into one undo step', () => {
    let state = createFormBuilderState(baseDocument());
    state = selectElement(state, 'full_name');
    state = updateElement(state, 'full_name', { label: 'F' }, { coalesceId: 'label.full_name' });
    state = updateElement(state, 'full_name', { label: 'Fu' }, { coalesceId: 'label.full_name' });
    state = updateElement(state, 'full_name', { label: 'Full' }, { coalesceId: 'label.full_name' });

    state = undo(state);
    expect(getDocument(state).elements[1].label).toBe('Full name');
    expect(canUndo(state)).toBe(false);
  });

  it('drops a selection the undo removed from the form', () => {
    let state = createFormBuilderState(baseDocument());
    state = insertElement(state, { type: 'checkbox', label: 'Needs a laptop' });
    expect(state.selectedKey).toBe('needs_a_laptop');

    state = undo(state);
    expect(state.selectedKey).toBeNull();
  });

  it('records a template choice and a settings change as undoable steps', () => {
    let state = createFormBuilderState(baseDocument());
    state = updateSettings(state, { submitLabel: 'Send it' });
    expect(getDocument(state).settings.submitLabel).toBe('Send it');

    state = replaceDocument(state, {
      elements: [{ key: 'only', type: 'short-text', label: 'Only' }],
      settings: {},
    });
    expect(keys(state)).toEqual(['only']);
    expect(state.selectedKey).toBe('only');

    state = undo(state);
    expect(getDocument(state).settings.submitLabel).toBe('Send it');
  });
});

describe('Try it seeding', () => {
  it('seeds the values the portal would start with and skips what carries no answer', () => {
    const values = buildTryItValues({
      elements: [
        { key: 'employee', type: 'section', label: 'Employee' },
        { key: 'full_name', type: 'short-text', label: 'Full name', defaultValue: 'Maya' },
        { key: 'agree', type: 'checkbox', label: 'Agree', defaultValue: true },
        { key: 'tags', type: 'multi-select', label: 'Tags', options: [{ label: 'A', value: 'a' }] },
        { key: 'policy', type: 'file-upload', label: 'Policy' },
      ],
      settings: {},
    });

    expect(values).toEqual({ full_name: 'Maya', agree: true, tags: [] });
  });
});
