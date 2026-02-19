import { describe, expect, it } from 'vitest';
import {
  InvoiceTemplateStrategyResolutionError,
  executeInvoiceTemplateStrategy,
  isAllowlistedInvoiceTemplateStrategy,
  listAllowlistedInvoiceTemplateStrategyIds,
  resolveInvoiceTemplateStrategy,
} from './strategies';

describe('invoice template strategy registry', () => {
  it('resolves and executes known strategy IDs', () => {
    expect(isAllowlistedInvoiceTemplateStrategy('custom-group-key')).toBe(true);
    expect(isAllowlistedInvoiceTemplateStrategy('custom-aggregate')).toBe(true);

    const groupKeyStrategy = resolveInvoiceTemplateStrategy('custom-group-key');
    expect(groupKeyStrategy({ item: { category: '  Consulting  ' } })).toBe('consulting');

    const total = executeInvoiceTemplateStrategy('custom-aggregate', {
      items: [{ total: 10 }, { total: '5.5' }, { total: null }],
      path: 'total',
    });
    expect(total).toBe(15.5);
  });

  it('rejects unknown strategy IDs', () => {
    expect(isAllowlistedInvoiceTemplateStrategy('unknown-strategy')).toBe(false);
    expect(listAllowlistedInvoiceTemplateStrategyIds()).toEqual(
      expect.arrayContaining(['custom-group-key', 'custom-aggregate'])
    );

    expect(() => resolveInvoiceTemplateStrategy('unknown-strategy')).toThrow(InvoiceTemplateStrategyResolutionError);
    expect(() => executeInvoiceTemplateStrategy('unknown-strategy', {})).toThrow(
      /not allowlisted/i
    );
  });
});
