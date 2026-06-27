import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_TYPES,
  getDocumentTypeRegistryEntry,
  getDocumentTypeStandardAst,
  isDocumentType,
} from './registry';

describe('document type registry', () => {
  it('registers sales-order as the first document type', () => {
    expect(DOCUMENT_TYPES).toContain('sales-order');
    expect(isDocumentType('sales-order')).toBe(true);
    expect(isDocumentType('invoice')).toBe(false);
  });

  it('exposes the sales-order standard template + bindings catalog', () => {
    const entry = getDocumentTypeRegistryEntry('sales-order');
    expect(entry.label).toBe('Sales Order');
    expect(entry.standardCodes).toContain(entry.defaultStandardCode);

    const bindings = entry.buildBindings();
    expect(bindings.values).toHaveProperty('orderNumber');
    expect(bindings.collections).toHaveProperty('lineItems');
  });

  it('resolves the registered standard AST for the type', () => {
    const ast = getDocumentTypeStandardAst('sales-order');
    expect(ast.metadata?.templateName).toBe('Standard Sales Order Confirmation');
    // a fresh clone each call (mutating one must not affect the catalog)
    expect(getDocumentTypeStandardAst('sales-order')).not.toBe(ast);
  });
});
