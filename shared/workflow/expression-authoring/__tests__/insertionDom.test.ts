// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { insertTextIntoDomControl, insertTextIntoMonacoEditor, insertTextIntoValue } from '../insertion';

describe('shared insertion helpers', () => {
  it('inserts text at start/middle/end offsets for plain values', () => {
    const base = { value: 'invoice.total' };

    expect(insertTextIntoValue({ ...base, selectionStart: 0, selectionEnd: 0 }, 'vars.').nextValue).toBe(
      'vars.invoice.total'
    );
    expect(insertTextIntoValue({ ...base, selectionStart: 7, selectionEnd: 7 }, '::').nextValue).toBe(
      'invoice::.total'
    );
    expect(insertTextIntoValue({ ...base, selectionStart: 13, selectionEnd: 13 }, '.amount').nextValue).toBe(
      'invoice.total.amount'
    );
  });

  it('replaces the active selection range', () => {
    const result = insertTextIntoValue(
      {
        value: '{{invoice.total}}',
        selectionStart: 2,
        selectionEnd: 15,
      },
      'customer.name'
    );

    expect(result.nextValue).toBe('{{customer.name}}');
    expect(result.selectionStart).toBe(15);
    expect(result.selectionEnd).toBe(15);
  });

  it('returns no-op for readonly, disabled, or unfocused controls', () => {
    const readonlyInput = document.createElement('input');
    readonlyInput.value = 'invoice.number';
    readonlyInput.readOnly = true;
    readonlyInput.setSelectionRange(0, 0);

    const disabledInput = document.createElement('input');
    disabledInput.value = 'invoice.number';
    disabledInput.disabled = true;
    disabledInput.setSelectionRange(0, 0);

    const unfocusedInput = document.createElement('input');
    unfocusedInput.value = 'invoice.number';
    unfocusedInput.setSelectionRange(0, 0);
    document.body.appendChild(unfocusedInput);
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();

    expect(insertTextIntoDomControl(readonlyInput, 'customer.name').reason).toBe('readonly');
    expect(insertTextIntoDomControl(disabledInput, 'customer.name').reason).toBe('disabled');
    expect(insertTextIntoDomControl(unfocusedInput, 'customer.name', { requireFocus: true }).reason).toBe(
      'unfocused'
    );
  });

  it('uses shared Monaco insertion semantics and keeps cursor at inserted range end', () => {
    let currentValue = 'payload.id';
    let selection = {
      startLineNumber: 1,
      startColumn: 9,
      endLineNumber: 1,
      endColumn: 11,
    };
    let cursor = { lineNumber: 1, column: 11 };

    const model = {
      getValue: () => currentValue,
      getOffsetAt: (position: { lineNumber: number; column: number }) => position.column - 1,
      getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    };

    const editor = {
      hasTextFocus: () => true,
      getModel: () => model,
      getSelection: () => selection,
      executeEdits: (
        _source: string,
        edits: Array<{
          range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
          text: string;
        }>
      ) => {
        const edit = edits[0];
        if (!edit) return;
        const startOffset = edit.range.startColumn - 1;
        const endOffset = edit.range.endColumn - 1;
        currentValue = `${currentValue.slice(0, startOffset)}${edit.text}${currentValue.slice(endOffset)}`;
      },
      setPosition: (position: { lineNumber: number; column: number }) => {
        cursor = position;
      },
      setSelection: (nextSelection: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      }) => {
        selection = nextSelection;
      },
      focus: () => {},
    };

    const result = insertTextIntoMonacoEditor(editor, 'name', {
      source: 'insertion-monaco-test',
    });

    expect(result.didInsert).toBe(true);
    expect(result.nextValue).toBe('payload.name');
    expect(selection.startColumn).toBe(13);
    expect(selection.endColumn).toBe(13);
    expect(cursor.column).toBe(13);
  });
});
