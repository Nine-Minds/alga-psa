import { describe, expect, it } from 'vitest';
import type { InvoiceTemplateAst } from '@alga-psa/types';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';
import { evaluateInvoiceTemplateAst } from './evaluator';
import { renderEvaluatedInvoiceTemplateAst } from './react-renderer';

const invoiceFixture = {
  invoiceNumber: 'INV-1001',
  subtotal: 300,
  tax: 30,
  total: 330,
  items: [
    { id: 'a', description: 'Consulting', quantity: 2, unitPrice: 100, total: 200 },
    { id: 'b', description: 'Support', quantity: 1, unitPrice: 100, total: 100 },
  ],
};

describe('renderEvaluatedInvoiceTemplateAst', () => {
  it('renders HTML for text/field/table/totals node combinations', () => {
    const ast: InvoiceTemplateAst = {
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      bindings: {
        values: {
          invoiceNumber: { id: 'invoiceNumber', kind: 'value', path: 'invoiceNumber' },
        },
        collections: {
          lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
        },
      },
      transforms: {
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.shaped',
        operations: [
          {
            id: 'aggregate-total',
            type: 'aggregate',
            aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }],
          },
          {
            id: 'compose-totals',
            type: 'totals-compose',
            totals: [
              {
                id: 'grandTotal',
                label: 'Grand Total',
                value: { type: 'aggregate-ref', aggregateId: 'sumTotal' },
              },
            ],
          },
        ],
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'headline',
            type: 'text',
            content: {
              type: 'template',
              template: 'Invoice {{number}}',
              args: {
                number: { type: 'binding', bindingId: 'invoiceNumber' },
              },
            },
          },
          {
            id: 'invoice-number',
            type: 'field',
            label: 'Invoice #',
            binding: { bindingId: 'invoiceNumber' },
          },
          {
            id: 'line-items',
            type: 'dynamic-table',
            repeat: {
              sourceBinding: { bindingId: 'lineItems' },
              itemBinding: 'item',
            },
            columns: [
              { id: 'description', header: 'Description', value: { type: 'path', path: 'description' } },
              { id: 'total', header: 'Total', value: { type: 'path', path: 'total' } },
            ],
          },
          {
            id: 'totals',
            type: 'totals',
            sourceBinding: { bindingId: 'lineItems.shaped' },
            rows: [
              {
                id: 'grandTotal',
                label: 'Grand Total',
                value: { type: 'literal', value: 0 },
                emphasize: true,
              },
            ],
          },
        ],
      },
    };

    const evaluation = evaluateInvoiceTemplateAst(ast, invoiceFixture);
    const rendered = renderEvaluatedInvoiceTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('Invoice INV-1001');
    expect(rendered.html).toContain('Invoice #');
    expect(rendered.html).toContain('Consulting');
    expect(rendered.html).toContain('Support');
    expect(rendered.html).toContain('Grand Total');
    expect(rendered.html).toContain('300');
  });

  it('applies class tokens and style declarations consistently', () => {
    const ast: InvoiceTemplateAst = {
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      styles: {
        tokens: {
          brandColor: { id: 'brand-color', value: '#0044aa' },
        },
        classes: {
          heading: {
            color: 'var(--brand-color)',
            fontWeight: 700,
          },
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'headline',
            type: 'text',
            style: {
              tokenIds: ['heading'],
              inline: {
                fontSize: '20px',
              },
            },
            content: { type: 'literal', value: 'Styled title' },
          },
        ],
      },
    };

    const evaluation = evaluateInvoiceTemplateAst(ast, invoiceFixture);
    const rendered = renderEvaluatedInvoiceTemplateAst(ast, evaluation);

    expect(rendered.css).toContain('.ast-heading');
    expect(rendered.css).toContain('--brand-color');
    expect(rendered.html).toContain('class="ast-heading"');
    expect(rendered.html).toContain('font-size:20px');
  });

  it('escapes unsafe text content in rendered HTML', () => {
    const ast: InvoiceTemplateAst = {
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'unsafe',
            type: 'text',
            content: { type: 'literal', value: '<script>alert("xss")</script>' },
          },
        ],
      },
    };

    const evaluation = evaluateInvoiceTemplateAst(ast, invoiceFixture);
    const rendered = renderEvaluatedInvoiceTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(rendered.html).not.toContain('<script>alert("xss")</script>');
  });
});
