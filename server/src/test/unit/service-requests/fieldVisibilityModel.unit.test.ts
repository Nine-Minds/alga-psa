import { describe, expect, it } from 'vitest';
import {
  getFieldVisibilityRules,
  replaceFieldVisibilityRules,
} from '../../../app/msp/service-requests/fieldVisibilityModel';

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
