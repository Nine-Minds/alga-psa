// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { insertTextIntoDomControl, insertTextIntoValue } from '../insertion';

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
});
