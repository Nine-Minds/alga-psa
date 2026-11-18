import { describe, expect, it } from 'vitest';
import {
  computeVisibleFieldKeys,
  evaluateVisibilityRule,
  parseVisibilityRules,
  resolveVisibilitySourceValue,
  validateVisibilityRules,
  type VisibilityRule,
} from '../../../lib/service-requests/formVisibility';

const ctx = { requesterUserId: 'u1', clientId: 'c1', contactId: null };
const rule = (operator: VisibilityRule['operator'], value?: unknown): VisibilityRule => ({
  fieldKey: 'f',
  source: 's',
  operator,
  value,
});

describe('evaluateVisibilityRule operators', () => {
  it('equals is strict', () => {
    expect(evaluateVisibilityRule(rule('equals', 'a'), 'a')).toBe(true);
    expect(evaluateVisibilityRule(rule('equals', 'a'), 'b')).toBe(false);
    expect(evaluateVisibilityRule(rule('equals', 'true'), true)).toBe(false);
  });
  it('not-equals', () => {
    expect(evaluateVisibilityRule(rule('not-equals', 'a'), 'b')).toBe(true);
    expect(evaluateVisibilityRule(rule('not-equals', 'a'), 'a')).toBe(false);
  });
  it('is-true', () => {
    for (const v of [true, 'true', 'on', '1']) expect(evaluateVisibilityRule(rule('is-true'), v)).toBe(true);
    for (const v of [false, 'false', '', undefined, 'yes']) expect(evaluateVisibilityRule(rule('is-true'), v)).toBe(false);
  });
  it('is-false', () => {
    for (const v of [false, 'false', 'off', '0', null, undefined, '']) {
      expect(evaluateVisibilityRule(rule('is-false'), v)).toBe(true);
    }
    expect(evaluateVisibilityRule(rule('is-false'), true)).toBe(false);
  });
  it('has-value / is-empty', () => {
    expect(evaluateVisibilityRule(rule('has-value'), 'x')).toBe(true);
    expect(evaluateVisibilityRule(rule('has-value'), '  ')).toBe(false);
    expect(evaluateVisibilityRule(rule('has-value'), null)).toBe(false);
    expect(evaluateVisibilityRule(rule('is-empty'), '  ')).toBe(true);
    expect(evaluateVisibilityRule(rule('is-empty'), undefined)).toBe(true);
    expect(evaluateVisibilityRule(rule('is-empty'), 'x')).toBe(false);
  });
});

describe('resolveVisibilitySourceValue', () => {
  it('handles bare key, payload.x and context sources', () => {
    const values = { a: 1, 'a.b': 'literal' };
    expect(resolveVisibilitySourceValue('a', values, ctx)).toBe(1);
    expect(resolveVisibilitySourceValue('payload.a', values, ctx)).toBe(1);
    expect(resolveVisibilitySourceValue('context.requesterUserId', values, ctx)).toBe('u1');
    expect(resolveVisibilitySourceValue('context.clientId', values, ctx)).toBe('c1');
    expect(resolveVisibilitySourceValue('context.contactId', values, ctx)).toBeNull();
  });
  it('looks payload.a.b up as the literal key "a.b"', () => {
    expect(resolveVisibilitySourceValue('payload.a.b', { a: { b: 'nested' }, 'a.b': 'literal' }, ctx)).toBe('literal');
    expect(resolveVisibilitySourceValue('payload.a.b', { a: { b: 'nested' } }, ctx)).toBeUndefined();
  });
});

describe('parse / validate', () => {
  it('drops invalid rules silently and trims keys', () => {
    const parsed = parseVisibilityRules({
      visibilityRules: [
        null,
        'x',
        { fieldKey: 'a', source: 's', operator: 'bogus' },
        { fieldKey: 1, source: 's', operator: 'equals' },
        { fieldKey: ' a ', source: ' s ', operator: 'equals', value: 'v' },
      ],
    });
    expect(parsed).toEqual([{ fieldKey: 'a', source: 's', operator: 'equals', value: 'v' }]);
    expect(parseVisibilityRules({})).toBeUndefined();
  });
  it('keeps validation messages verbatim', () => {
    expect(validateVisibilityRules({ visibilityRules: 'x' })).toEqual(['visibilityRules must be an array']);
    expect(
      validateVisibilityRules({
        visibilityRules: [null, { fieldKey: '', source: '', operator: 'nope' }, { fieldKey: 'a', source: 's', operator: 'equals' }],
      })
    ).toEqual([
      'visibilityRules[0] must be an object',
      'visibilityRules[1].fieldKey is required',
      'visibilityRules[1].source is required',
      'visibilityRules[1].operator must be one of equals, not-equals, is-true, is-false, has-value, is-empty',
      'visibilityRules[2].value is required for equals',
    ]);
    expect(validateVisibilityRules({})).toEqual([]);
  });
});

describe('computeVisibleFieldKeys', () => {
  const fields = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { notAKey: true }];

  it('returns all keys when there are no rules', () => {
    expect(computeVisibleFieldKeys(fields, [], {}, ctx)).toEqual(['a', 'b', 'c']);
  });
  it('ANDs multiple rules on one field', () => {
    const rules: VisibilityRule[] = [
      { fieldKey: 'b', source: 'a', operator: 'has-value' },
      { fieldKey: 'b', source: 'context.clientId', operator: 'equals', value: 'c1' },
    ];
    expect(computeVisibleFieldKeys(fields, rules, { a: 'x' }, ctx)).toEqual(['a', 'b', 'c']);
    expect(computeVisibleFieldKeys(fields, rules, { a: '' }, ctx)).toEqual(['a', 'c']);
    expect(computeVisibleFieldKeys(fields, rules, { a: 'x' }, { ...ctx, clientId: 'other' })).toEqual(['a', 'c']);
  });
  it('treats a hidden source field as empty (chained rules)', () => {
    const rules: VisibilityRule[] = [
      { fieldKey: 'b', source: 'a', operator: 'equals', value: 'yes' },
      { fieldKey: 'c', source: 'b', operator: 'has-value' },
    ];
    // b has a stale answer but is hidden, so c must be hidden too.
    expect(computeVisibleFieldKeys(fields, rules, { a: 'no', b: 'stale' }, ctx)).toEqual(['a']);
    expect(computeVisibleFieldKeys(fields, rules, { a: 'yes', b: 'x' }, ctx)).toEqual(['a', 'b', 'c']);
  });
  it('cannot cycle: forward references see the raw value', () => {
    const rules: VisibilityRule[] = [
      { fieldKey: 'a', source: 'b', operator: 'is-empty' },
      { fieldKey: 'b', source: 'a', operator: 'is-empty' },
    ];
    expect(computeVisibleFieldKeys(fields, rules, {}, ctx)).toEqual(['a', 'b', 'c']);
    expect(computeVisibleFieldKeys(fields, rules, { b: 'x' }, ctx)).toEqual(['b', 'c']);
  });
  it('does not match a checkbox boolean against the string "true"', () => {
    const rules: VisibilityRule[] = [{ fieldKey: 'b', source: 'a', operator: 'equals', value: 'true' }];
    expect(computeVisibleFieldKeys(fields, rules, { a: true }, ctx)).toEqual(['a', 'c']);
    const boolRules: VisibilityRule[] = [{ fieldKey: 'b', source: 'a', operator: 'equals', value: true }];
    expect(computeVisibleFieldKeys(fields, boolRules, { a: true }, ctx)).toEqual(['a', 'b', 'c']);
  });
});
