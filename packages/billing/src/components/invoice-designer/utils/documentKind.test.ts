import { describe, expect, it } from 'vitest';
import { buildQuoteTemplateBindings } from '../../../lib/quote-template-ast/bindings';
import { buildSalesOrderTemplateBindings } from '../../../lib/sales-order-template-ast/bindings';
import { buildInvoiceTemplateBindings, getStandardTemplateAstByCode } from '../../../lib/invoice-template-ast/standardTemplates';
import { buildLabelTemplateBindings } from '../../../lib/label-template-ast/bindings';
import { resolveDesignerDocumentKind } from './documentKind';

const buildDocumentNode = (metadata: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  type: 'document',
  parentId: null,
  children: [],
  props: {
    name: 'Document',
    metadata,
  },
}) as any;

describe('resolveDesignerDocumentKind', () => {
  it('defaults to invoice when no document node exists', () => {
    expect(resolveDesignerDocumentKind([] as any)).toBe('invoice');
  });

  it('detects label binding catalogs as work-tag (not quote, despite clientName/tenantName)', () => {
    const nodes = [buildDocumentNode({ __astBindingCatalog: buildLabelTemplateBindings() })];

    expect(resolveDesignerDocumentKind(nodes)).toBe('work-tag');
  });

  it('detects quote binding catalogs from quote-specific bindings', () => {
    const nodes = [
      buildDocumentNode({
        __astBindingCatalog: buildQuoteTemplateBindings(),
      }),
    ];

    expect(resolveDesignerDocumentKind(nodes)).toBe('quote');
  });

  it('does not misclassify invoice template bindings as quote bindings', () => {
    const invoiceAst = getStandardTemplateAstByCode('standard-detailed');
    const nodes = [
      buildDocumentNode({
        __astBindingCatalog: invoiceAst?.bindings,
      }),
    ];

    expect(resolveDesignerDocumentKind(nodes)).toBe('invoice');
  });

  it('keeps the full invoice binding catalog (which now publishes discountTotal) classified as invoice', () => {
    const bindings = buildInvoiceTemplateBindings();
    expect(bindings.values).toHaveProperty('discountTotal');
    expect(resolveDesignerDocumentKind([buildDocumentNode({ __astBindingCatalog: bindings })])).toBe('invoice');
  });

  it('detects sales-order binding catalogs (and prefers them over the shared quote/tenant bindings)', () => {
    const nodes = [
      buildDocumentNode({
        __astBindingCatalog: buildSalesOrderTemplateBindings(),
      }),
    ];

    expect(resolveDesignerDocumentKind(nodes)).toBe('sales-order');
  });

  it('detects sales-order from template metadata naming', () => {
    const nodes = [
      buildDocumentNode({
        __astTemplateMetadata: { templateName: 'Standard Sales Order Confirmation' },
      }),
    ];

    expect(resolveDesignerDocumentKind(nodes)).toBe('sales-order');
  });

  it('falls back to template metadata naming when quote bindings are unavailable', () => {
    const nodes = [
      buildDocumentNode({
        __astTemplateMetadata: {
          templateName: 'Standard Quote Layout',
        },
      }),
    ];

    expect(resolveDesignerDocumentKind(nodes)).toBe('quote');
  });
});
