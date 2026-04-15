import { describe, expect, it } from 'vitest';
import {
  TemplateStrategyResolutionError,
  executeTemplateStrategy,
  isAllowlistedTemplateStrategy,
  listAllowlistedTemplateStrategyIds,
  resolveTemplateStrategy,
} from './strategies';

describe('invoice template strategy registry', () => {
  it('resolves and executes known strategy IDs', () => {
    expect(isAllowlistedTemplateStrategy('custom-group-key')).toBe(true);
    expect(isAllowlistedTemplateStrategy('custom-aggregate')).toBe(true);

    const groupKeyStrategy = resolveTemplateStrategy('custom-group-key');
    expect(groupKeyStrategy({ item: { category: '  Consulting  ' } })).toBe('consulting');

    const total = executeTemplateStrategy('custom-aggregate', {
      items: [{ total: 10 }, { total: '5.5' }, { total: null }],
      path: 'total',
    });
    expect(total).toBe(15.5);
  });

  it('rejects unknown strategy IDs', () => {
    expect(isAllowlistedTemplateStrategy('unknown-strategy')).toBe(false);
    expect(listAllowlistedTemplateStrategyIds()).toEqual(
      expect.arrayContaining(['custom-group-key', 'custom-aggregate'])
    );

    expect(() => resolveTemplateStrategy('unknown-strategy')).toThrow(TemplateStrategyResolutionError);
    expect(() => executeTemplateStrategy('unknown-strategy', {})).toThrow(
      /not allowlisted/i
    );
  });
});
