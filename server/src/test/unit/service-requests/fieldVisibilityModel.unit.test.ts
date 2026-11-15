import { describe, expect, it } from 'vitest';
import {
  getFieldVisibilityRules,
  getVisibilityOperatorsForType,
  replaceFieldVisibilityRules,
} from '../../../app/msp/service-requests/fieldVisibilityModel';

describe('operators offered per source type', () => {
  it('offers is-true / is-false to checkboxes only', () => {
    expect(getVisibilityOperatorsForType('checkbox')).toEqual([
      'is-true',
      'is-false',
      'equals',
      'not-equals',
    ]);
    for (const type of ['short-text', 'long-text', 'email', 'select', 'radio', 'number', 'date']) {
      expect(getVisibilityOperatorsForType(type)).not.toContain('is-true');
      expect(getVisibilityOperatorsForType(type)).not.toContain('is-false');
    }
  });

  it('offers emptiness only where a value can be absent', () => {
    expect(getVisibilityOperatorsForType('short-text')).toEqual([
      'equals',
      'not-equals',
      'has-value',
      'is-empty',
    ]);
    expect(getVisibilityOperatorsForType('multi-select')).toEqual(['has-value', 'is-empty']);
  });

  it('falls back to the whole dialect for a type the registry does not know', () => {
    expect(getVisibilityOperatorsForType('something-new')).toEqual([
      'equals',
      'not-equals',
      'is-true',
      'is-false',
      'has-value',
      'is-empty',
    ]);
  });
});

describe('fieldVisibilityModel', () => {
  const config = {
    contextDefaults: { dept: '{{clientId}}' },
    somethingElse: 1,
    visibilityRules: [
      { fieldKey: 'a', source: 'x', operator: 'is-true' },
      { fieldKey: 'b', source: 'x', operator: 'equals', value: true },
      'garbage',
      { fieldKey: 'a', source: 'y', operator: 'equals', value: 'v' },
    ],
  };

  it('reads only the target field rules', () => {
    expect(getFieldVisibilityRules(config, 'a')).toEqual([
      { fieldKey: 'a', source: 'x', operator: 'is-true' },
      { fieldKey: 'a', source: 'y', operator: 'equals', value: 'v' },
    ]);
  });

  it('replaces only this field rules and preserves contextDefaults and others', () => {
    const next = replaceFieldVisibilityRules(config, 'a', [
      { fieldKey: 'a', source: 'z', operator: 'equals', value: false },
    ]);
    expect(next.contextDefaults).toEqual({ dept: '{{clientId}}' });
    expect(next.somethingElse).toBe(1);
    expect(next.visibilityRules).toEqual([
      { fieldKey: 'b', source: 'x', operator: 'equals', value: true },
      'garbage',
      { fieldKey: 'a', source: 'z', operator: 'equals', value: false },
    ]);
  });

  it('drops the key when no rules remain and does not mutate the input', () => {
    const only = { contextDefaults: {}, visibilityRules: [{ fieldKey: 'a', source: 'x', operator: 'is-true' }] };
    const next = replaceFieldVisibilityRules(only, 'a', []);
    expect(next).toEqual({ contextDefaults: {} });
    expect(only.visibilityRules).toHaveLength(1);
  });
});
