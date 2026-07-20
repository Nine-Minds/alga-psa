import { describe, expect, it } from 'vitest';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';

import {
  QUOTE_TEMPLATE_VALUE_BINDINGS,
  QUOTE_TEMPLATE_COLLECTION_BINDINGS,
  buildQuoteTemplateBindings,
} from '../../src/lib/quote-template-ast/bindings';

import {
  STANDARD_QUOTE_TEMPLATE_ASTS,
  getStandardQuoteTemplateAstByCode,
} from '../../src/lib/quote-template-ast/standardTemplates';
import { evaluateTemplateAst } from '../../src/lib/invoice-template-ast/evaluator';
import { renderTemplateAstHtmlDocument } from '../../src/lib/invoice-template-ast/server-render';

// ── bindings ─────────────────────────────────────────────────────────
describe('quote-template-ast – bindings', () => {
  it('T230: value bindings include all expected quote fields', () => {
    const requiredIds = [
      'quoteNumber', 'quoteDate', 'validUntil', 'status', 'title', 'scope',
      'subtotal', 'discountTotal', 'tax', 'total',
      'termsAndConditions', 'clientNotes', 'version',
      'clientName', 'clientAddress', 'contactName',
      'tenantName', 'tenantAddress', 'tenantLogo',
    ];

    for (const id of requiredIds) {
      expect(QUOTE_TEMPLATE_VALUE_BINDINGS).toHaveProperty(id);
      expect(QUOTE_TEMPLATE_VALUE_BINDINGS[id].kind).toBe('value');
      expect(QUOTE_TEMPLATE_VALUE_BINDINGS[id].path).toBeTruthy();
    }
  });

  it('T231: collection bindings include lineItems and phases', () => {
    expect(QUOTE_TEMPLATE_COLLECTION_BINDINGS.lineItems).toBeDefined();
    expect(QUOTE_TEMPLATE_COLLECTION_BINDINGS.lineItems.kind).toBe('collection');
    expect(QUOTE_TEMPLATE_COLLECTION_BINDINGS.lineItems.path).toBe('line_items');

    expect(QUOTE_TEMPLATE_COLLECTION_BINDINGS.phases).toBeDefined();
    expect(QUOTE_TEMPLATE_COLLECTION_BINDINGS.phases.kind).toBe('collection');
    expect(QUOTE_TEMPLATE_COLLECTION_BINDINGS.phases.path).toBe('phases');
  });

  it('T232: buildQuoteTemplateBindings returns values and collections', () => {
    const bindings = buildQuoteTemplateBindings();
    expect(bindings.values).toBeDefined();
    expect(bindings.collections).toBeDefined();
    expect(Object.keys(bindings.values!).length).toBeGreaterThan(0);
    expect(Object.keys(bindings.collections!)).toEqual(
      Object.keys(QUOTE_TEMPLATE_COLLECTION_BINDINGS),
    );
  });

  it('T233: value bindings provide fallbacks for display fields', () => {
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.clientName.fallback).toBe('Client');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.tenantName.fallback).toBe('Your Company');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.scope.fallback).toBe('');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.termsAndConditions.fallback).toBe('');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.clientNotes.fallback).toBe('');
  });

  it('T234: poNumber binding has no path collision with quoteNumber', () => {
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.poNumber.path).toBe('po_number');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.quoteNumber.path).toBe('quote_number');
  });
});

// ── standardTemplates ────────────────────────────────────────────────
describe('quote-template-ast – standardTemplates', () => {
  it('T235: exposes standard-quote-default and standard-quote-detailed', () => {
    expect(STANDARD_QUOTE_TEMPLATE_ASTS).toHaveProperty('standard-quote-default');
    expect(STANDARD_QUOTE_TEMPLATE_ASTS).toHaveProperty('standard-quote-detailed');
  });

  it('T236: each standard template has the correct AST structure', () => {
    for (const [code, ast] of Object.entries(STANDARD_QUOTE_TEMPLATE_ASTS)) {
      expect(ast.kind).toBe('invoice-template-ast');
      expect(ast.version).toBe(TEMPLATE_AST_VERSION);
      expect(ast.metadata?.templateName).toBeTruthy();
      expect(ast.bindings).toBeDefined();
      expect(ast.layout).toBeDefined();
      expect(ast.layout.type).toBe('document');
      expect(ast.layout.children?.length).toBeGreaterThan(0);
    }
  });

  it('T237: standard-quote-default includes line items table and totals', () => {
    const ast = STANDARD_QUOTE_TEMPLATE_ASTS['standard-quote-default'];
    const nodeIds = collectNodeIds(ast.layout);
    expect(nodeIds).toContain('line-items');
    expect(nodeIds).toContain('totals');
    expect(nodeIds).toContain('quote-number');
    expect(nodeIds).toContain('signature-block');
  });

  it('T238: standard-quote-detailed includes phase summary and version field', () => {
    const ast = STANDARD_QUOTE_TEMPLATE_ASTS['standard-quote-detailed'];
    const nodeIds = collectNodeIds(ast.layout);
    expect(nodeIds).toContain('phase-summary');
    expect(nodeIds).toContain('line-items-detailed');
    expect(nodeIds).toContain('version');
  });

  it('T239: getStandardQuoteTemplateAstByCode returns a clone', () => {
    const a = getStandardQuoteTemplateAstByCode('standard-quote-default');
    const b = getStandardQuoteTemplateAstByCode('standard-quote-default');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('T240: getStandardQuoteTemplateAstByCode returns null for unknown code', () => {
    const result = getStandardQuoteTemplateAstByCode('nonexistent-template');
    expect(result).toBeNull();
  });

  it('T241: standard templates use quote template bindings', () => {
    for (const ast of Object.values(STANDARD_QUOTE_TEMPLATE_ASTS)) {
      const bindings = ast.bindings!;
      expect(bindings.values?.quoteNumber).toBeDefined();
      expect(bindings.values?.subtotal).toBeDefined();
      expect(bindings.collections?.lineItems).toBeDefined();
    }
  });

  it('renders native quote party and date bindings without invoice aliases', async () => {
    const ast = getStandardQuoteTemplateAstByCode('standard-quote-default');
    expect(ast).not.toBeNull();
    if (!ast) {
      throw new Error('Expected the standard quote template to exist.');
    }

    const evaluation = evaluateTemplateAst(ast, {
      quote_number: 'Q-0003',
      quote_date: '2026-07-13',
      valid_until: '2026-08-12',
      title: 'Managed Services Proposal',
      currency_code: 'USD',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      line_items: [],
      client: { name: 'Acme Corp', address: '123 Main St' },
      tenant: { name: 'Northwind MSP', address: '400 SW Main' },
    });
    const html = await renderTemplateAstHtmlDocument(ast, evaluation, { title: 'Quote Q-0003' });

    expect(html).toContain('Acme Corp');
    expect(html).toContain('123 Main St');
    expect(html).toContain('Northwind MSP');
    expect(html).toContain('400 SW Main');
    expect(html).toContain('7/13/2026');
    expect(html).toContain('8/12/2026');
    expect(html).not.toContain('Your Company');
  });
});

// ── helpers ──────────────────────────────────────────────────────────
function collectNodeIds(node: any): string[] {
  const ids: string[] = [];
  if (node.id) ids.push(node.id);
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      ids.push(...collectNodeIds(child));
    }
  }
  return ids;
}
