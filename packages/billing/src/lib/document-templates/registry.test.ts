import { describe, expect, it } from 'vitest';

import { evaluateTemplateAst } from '../invoice-template-ast/evaluator';
import { renderTemplateAstHtmlDocument } from '../invoice-template-ast/server-render';
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

  it('registers packing-slip and pick-list as additional document types', () => {
    expect(DOCUMENT_TYPES).toEqual(expect.arrayContaining(['sales-order', 'packing-slip', 'pick-list']));
    expect(getDocumentTypeRegistryEntry('packing-slip').label).toBe('Packing Slip');
    expect(getDocumentTypeRegistryEntry('pick-list').label).toBe('Pick List');
  });

  it('renders the packing slip and pick list standards against the shared SO sample', async () => {
    for (const [type, marker, absent] of [
      ['packing-slip', 'PACKING SLIP', 'Order Total'],
      ['pick-list', 'PICK LIST', 'Ship To'],
    ] as const) {
      const entry = getDocumentTypeRegistryEntry(type);
      const ast = getDocumentTypeStandardAst(type);
      const evaluation = evaluateTemplateAst(ast, entry.buildSampleViewModel());
      const html = await renderTemplateAstHtmlDocument(ast, evaluation, { title: type });
      expect(html).toContain(marker);
      expect(html).toContain('SO-00042');
      // packing slip / pick list omit prices/customer respectively
      expect(html).not.toContain(absent);
    }
  });

  it('the sample view model renders against the standard template (the preview path)', async () => {
    const entry = getDocumentTypeRegistryEntry('sales-order');
    const sample = entry.buildSampleViewModel();
    const ast = getDocumentTypeStandardAst('sales-order');

    const evaluation = evaluateTemplateAst(ast, sample);
    const html = await renderTemplateAstHtmlDocument(ast, evaluation, { title: 'Preview' });

    expect(html).toContain('ORDER CONFIRMATION');
    expect(html).toContain('SO-00042');
    expect(html).toContain('Acme Corp');
  });
});
