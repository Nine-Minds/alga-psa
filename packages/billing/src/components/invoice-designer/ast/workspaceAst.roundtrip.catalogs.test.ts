import { describe, expect, it } from 'vitest';
import { createAstDocument, findNodeById, getDocumentNode, roundTripAst } from './workspaceAst.roundtrip.helpers';

describe('workspaceAst roundtrip metadata/style/binding catalogs', () => {
  it('preserves template metadata, styles catalog, and root id', () => {
    const ast = createAstDocument(
      [
        {
          id: 'header',
          type: 'section',
          children: [{ id: 'title', type: 'text', content: { type: 'literal', value: 'Invoice' } }],
        },
      ],
      {
        metadata: {
          templateName: 'Catalog Test',
          description: 'Roundtrip',
          locale: 'en-US',
          currencyCode: 'USD',
        },
        styles: {
          tokens: {
            primary: { id: 'primary', value: '#0f172a' },
          },
          classes: {
            heading: { fontSize: '20px', fontWeight: 700 },
          },
        },
        layout: { id: 'template-root' },
      }
    );

    const roundTripped = roundTripAst(ast);
    expect(roundTripped.metadata).toEqual(ast.metadata);
    expect(roundTripped.styles).toEqual(ast.styles);
    expect(getDocumentNode(roundTripped).id).toBe('template-root');
  });

  it('reuses existing binding ids by path and does not synthesize duplicate bindings', () => {
    const ast = createAstDocument(
      [
        {
          id: 'header',
          type: 'section',
          children: [
            {
              id: 'invoice-number',
              type: 'field',
              binding: { bindingId: 'fieldInvoiceNumber' },
              label: 'Invoice #',
            },
            {
              id: 'issue-date',
              type: 'field',
              binding: { bindingId: 'fieldIssueDate' },
              label: 'Issue Date',
              format: 'date',
            },
          ],
        },
        {
          id: 'line-items',
          type: 'dynamic-table',
          repeat: {
            sourceBinding: { bindingId: 'itemsBinding' },
            itemBinding: 'line',
          },
          columns: [{ id: 'description', header: 'Description', value: { type: 'path', path: 'description' } }],
        },
        {
          id: 'totals',
          type: 'totals',
          sourceBinding: { bindingId: 'itemsBinding' },
          rows: [{ id: 'total', label: 'Total', value: { type: 'binding', bindingId: 'totalValue' }, format: 'currency' }],
        },
      ],
      {
        bindings: {
          values: {
            fieldInvoiceNumber: { id: 'fieldInvoiceNumber', kind: 'value', path: 'invoiceNumber' },
            fieldIssueDate: { id: 'fieldIssueDate', kind: 'value', path: 'issueDate' },
            totalValue: { id: 'totalValue', kind: 'value', path: 'total', fallback: 0 },
          },
          collections: {
            itemsBinding: { id: 'itemsBinding', kind: 'collection', path: 'items' },
          },
        },
      }
    );

    const roundTripped = roundTripAst(ast);
    const values = roundTripped.bindings?.values ?? {};
    const collections = roundTripped.bindings?.collections ?? {};

    expect(Object.keys(values).sort()).toEqual(['fieldInvoiceNumber', 'fieldIssueDate', 'totalValue']);
    expect(Object.keys(collections).sort()).toEqual(['itemsBinding']);
    expect(values.totalValue?.fallback).toBe(0);

    const layout = getDocumentNode(roundTripped);
    const invoiceNumberField = findNodeById(layout, 'invoice-number');
    expect(invoiceNumberField?.type).toBe('field');
    if (invoiceNumberField?.type === 'field') {
      expect(invoiceNumberField.binding.bindingId).toBe('fieldInvoiceNumber');
    }

    const issueDateField = findNodeById(layout, 'issue-date');
    expect(issueDateField?.type).toBe('field');
    if (issueDateField?.type === 'field') {
      expect(issueDateField.binding.bindingId).toBe('fieldIssueDate');
      expect(issueDateField.format).toBe('date');
    }

    const table = findNodeById(layout, 'line-items');
    expect(table?.type).toBe('dynamic-table');
    if (table?.type === 'dynamic-table') {
      expect(table.repeat.sourceBinding.bindingId).toBe('itemsBinding');
    }

    const totals = findNodeById(layout, 'totals');
    expect(totals?.type).toBe('totals');
    if (totals?.type === 'totals') {
      expect(totals.sourceBinding.bindingId).toBe('itemsBinding');
      expect(totals.rows[0]?.value).toEqual({ type: 'binding', bindingId: 'totalValue' });
    }
  });
});
