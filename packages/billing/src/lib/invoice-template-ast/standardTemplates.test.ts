import { describe, expect, it } from 'vitest';
import { getStandardInvoiceTemplateAstByCode, STANDARD_INVOICE_TEMPLATE_ASTS } from './standardTemplates';

describe('standard invoice template AST definitions', () => {
  it('exposes AST definitions for standard template codes', () => {
    expect(Object.keys(STANDARD_INVOICE_TEMPLATE_ASTS)).toEqual(
      expect.arrayContaining(['standard-default', 'standard-detailed'])
    );

    const standardDefaultAst = getStandardInvoiceTemplateAstByCode('standard-default');
    expect(standardDefaultAst?.kind).toBe('invoice-template-ast');
    expect(standardDefaultAst?.layout.type).toBe('document');
  });

  it('returns cloned AST payloads to avoid mutation leaks', () => {
    const first = getStandardInvoiceTemplateAstByCode('standard-default');
    const second = getStandardInvoiceTemplateAstByCode('standard-default');
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });
});
