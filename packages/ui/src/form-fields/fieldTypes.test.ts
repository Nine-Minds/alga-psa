/**
 * The field type registry is the one table every designer and every filter reads, so its
 * invariants are tested here rather than through whichever consumer happens to exercise them.
 */
import { describe, expect, it } from 'vitest';
import { PREDICATE_OPERATORS } from '@alga-psa/predicates';
import {
  FIELD_TYPE_KEYS,
  FIELD_TYPE_KINDS,
  FIELD_TYPE_REGISTRY,
  formatFieldValue,
  getFieldElementKind,
  getFieldType,
  isDisplayFieldType,
  isInputFieldType,
} from './registry';
import {
  describeFieldValidationIssue,
  normalizeFieldValidationRules,
  validateFieldValue,
} from './validation';

describe('field type registry', () => {
  it('keys every entry by its own key, and agrees with the kind table', () => {
    for (const key of FIELD_TYPE_KEYS) {
      const definition = FIELD_TYPE_REGISTRY[key];
      expect(definition.key).toBe(key);
      expect(FIELD_TYPE_KINDS[key]).toBe(definition.kind);
      expect(getFieldElementKind(key)).toBe(definition.kind);
      expect(isInputFieldType(key)).toBe(definition.kind === 'input');
      expect(isDisplayFieldType(key)).toBe(definition.kind === 'display');
    }
  });

  it('offers only operators that exist in the shared predicate vocabulary', () => {
    const known = new Set<string>(PREDICATE_OPERATORS);
    for (const key of FIELD_TYPE_KEYS) {
      for (const operator of FIELD_TYPE_REGISTRY[key].operators) {
        expect(known, `${key} offers ${operator}`).toContain(operator);
      }
    }
  });

  it('gives a display block no answer to carry', () => {
    for (const key of FIELD_TYPE_KEYS) {
      const definition = FIELD_TYPE_REGISTRY[key];
      if (definition.kind !== 'display') continue;
      expect(definition.valueShape).toBe('none');
      expect(definition.control).toBe('none');
      expect(definition.operators).toEqual([]);
      // Nothing is stored, so nothing can fail a check either.
      expect(validateFieldValue({ type: key, value: 'x', required: true })).toBeNull();
    }
  });

  it('treats an unknown type as no type at all rather than guessing one', () => {
    expect(getFieldType('rating-stars')).toBeNull();
    expect(getFieldElementKind('rating-stars')).toBe('input');
  });

  it('reads a stored answer back through its options', () => {
    const options = [
      { value: 'crm', label: 'CRM' },
      { value: 'vpn', label: 'VPN' },
    ];
    expect(formatFieldValue('select', 'vpn', options)).toBe('VPN');
    expect(formatFieldValue('multi-select', ['vpn', 'crm'], options)).toBe('VPN, CRM');
    expect(formatFieldValue('radio', 'crm', options)).toBe('CRM');
    // A value no longer on the list still reads as itself instead of vanishing.
    expect(formatFieldValue('select', 'erp', options)).toBe('erp');
  });
});

describe('field validation', () => {
  it('demands an answer only when the field is required', () => {
    expect(validateFieldValue({ type: 'short-text', value: '', required: true })).toEqual({
      rule: 'required',
    });
    expect(validateFieldValue({ type: 'short-text', value: '  ', required: true })).toEqual({
      rule: 'required',
    });
    // A blank optional answer passes every rule: rules constrain an answer, they don't ask for one.
    expect(
      validateFieldValue({ type: 'short-text', value: '', validation: { minLength: 5 } })
    ).toBeNull();
  });

  it('checks lengths, numbers, dates and selection counts', () => {
    expect(
      validateFieldValue({ type: 'short-text', value: 'ab', validation: { minLength: 3 } })
    ).toMatchObject({ rule: 'minLength', params: { minLength: 3 } });
    expect(
      validateFieldValue({ type: 'number', value: '12', validation: { max: 10 } })
    ).toMatchObject({ rule: 'max', params: { max: 10 } });
    // "ten" is no number, so the registry reads it as no answer: a required field says so.
    expect(validateFieldValue({ type: 'number', value: 'ten', required: true })).toEqual({
      rule: 'required',
    });
    expect(
      validateFieldValue({ type: 'date', value: '2026-01-01', validation: { minDate: '2026-02-01' } })
    ).toMatchObject({ rule: 'minDate' });
    // A date-time compares as an instant, not as text.
    expect(
      validateFieldValue({
        type: 'date-time',
        value: '2026-02-01T09:00:00.000Z',
        validation: { minDate: '2026-02-01T10:00:00.000Z' },
      })
    ).toMatchObject({ rule: 'minDate' });
    expect(
      validateFieldValue({ type: 'multi-select', value: ['a'], validation: { minSelected: 2 } })
    ).toMatchObject({ rule: 'minSelected' });
  });

  it('checks the shape of typed text fields', () => {
    expect(validateFieldValue({ type: 'email', value: 'nope' })).toMatchObject({ rule: 'type' });
    expect(validateFieldValue({ type: 'email', value: 'jane@example.com' })).toBeNull();
    expect(validateFieldValue({ type: 'url', value: 'example.com' })).toMatchObject({
      rule: 'type',
    });
    expect(validateFieldValue({ type: 'url', value: 'https://example.com' })).toBeNull();
    expect(validateFieldValue({ type: 'phone', value: '+46 70 123 45 67' })).toBeNull();
  });

  it('never lets an unparseable pattern block a submission', () => {
    expect(
      validateFieldValue({ type: 'short-text', value: 'anything', validation: { pattern: '([' } })
    ).toBeNull();
  });

  it('drops rules that do not belong to the type', () => {
    // Retyping a question from number to text must not leave min/max constraining it.
    expect(normalizeFieldValidationRules('short-text', { min: 1, max: 9, maxLength: 20 })).toEqual({
      maxLength: 20,
    });
    expect(normalizeFieldValidationRules('number', { min: 1, maxLength: 20 })).toEqual({ min: 1 });
    expect(normalizeFieldValidationRules('section', { minLength: 2 })).toBeUndefined();
    expect(normalizeFieldValidationRules('short-text', null)).toBeUndefined();
  });

  it('prefers the author custom message, except for a missing required answer', () => {
    const issue = validateFieldValue({
      type: 'short-text',
      value: 'ab',
      validation: { minLength: 3, message: 'Give us the full name.' },
    });
    expect(describeFieldValidationIssue(issue!, 'Full name')).toBe(
      '"Full name": Give us the full name.'
    );
    expect(describeFieldValidationIssue({ rule: 'required' }, 'Full name')).toBe(
      'Required field missing: "Full name"'
    );
  });
});
