import { describe, expect, it } from 'vitest';
import type { InvoiceTemplateAst } from '@alga-psa/types';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';
import type { InvoiceTemplateEvaluationResult } from './evaluator';
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
  it('renders HTML for text/field/table/totals node combinations', async () => {
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
    const rendered = await renderEvaluatedInvoiceTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('Invoice INV-1001');
    expect(rendered.html).toContain('Invoice #');
    expect(rendered.html).toContain('Consulting');
    expect(rendered.html).toContain('Support');
    expect(rendered.html).toContain('Grand Total');
    expect(rendered.html).toContain('300');
  });

  it('renders grouped dynamic-table rows from a transformed output binding', async () => {
    const ast: InvoiceTemplateAst = {
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      bindings: {
        collections: {
          lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
        },
      },
      transforms: {
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.grouped',
        operations: [
          {
            id: 'group-category',
            type: 'group',
            key: 'category',
          },
          {
            id: 'aggregate-total',
            type: 'aggregate',
            aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }],
          },
        ],
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'grouped-line-items',
            type: 'dynamic-table',
            repeat: {
              sourceBinding: { bindingId: 'lineItems.grouped' },
              itemBinding: 'item',
            },
            columns: [
              { id: 'group', header: 'Group', value: { type: 'path', path: 'key' } },
              { id: 'rolled-up-total', header: 'Rolled Up Total', value: { type: 'path', path: 'aggregates.sumTotal' } },
            ],
          },
        ],
      },
    };

    const evaluation = evaluateInvoiceTemplateAst(ast, {
      ...invoiceFixture,
      items: [
        { id: 'a', description: 'Consulting', category: 'Services', quantity: 2, unitPrice: 100, total: 200 },
        { id: 'b', description: 'Support', category: 'Services', quantity: 1, unitPrice: 100, total: 100 },
        { id: 'c', description: 'Equipment', category: 'Products', quantity: 1, unitPrice: 30, total: 30 },
      ],
    });
    const rendered = await renderEvaluatedInvoiceTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('Group');
    expect(rendered.html).toContain('Rolled Up Total');
    expect(rendered.html).toContain('Services');
    expect(rendered.html).toContain('Products');
    expect(rendered.html).toContain('300');
    expect(rendered.html).toContain('30');
  });

  it('formats template path expressions using currency filter syntax', async () => {
    const ast: InvoiceTemplateAst = {
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      bindings: {
        values: {
          total: { id: 'total', kind: 'value', path: 'total' },
        },
        collections: {},
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
              template: 'Amount due {{amount}}',
              args: {
                amount: { type: 'path', path: 'total|currency' },
              },
            },
          },
        ],
      },
    };

    const evaluation = evaluateInvoiceTemplateAst(ast, invoiceFixture);
    const rendered = await renderEvaluatedInvoiceTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('Amount due $3.30');
    expect(rendered.html).not.toContain('Amount due 330');
  });

  it('renders grouped transform outputs through dynamic-table bindings using key and aggregate paths', async () => {
    const groupedInvoiceFixture = {
      ...invoiceFixture,
      items: [
        { id: 'a', description: 'Consulting', quantity: 2, unitPrice: 100, total: 200, category: 'Services' },
        { id: 'b', description: 'Support', quantity: 1, unitPrice: 100, total: 100, category: 'Services' },
        { id: 'c', description: 'Hardware', quantity: 1, unitPrice: 30, total: 30, category: 'Products' },
      ],
    };
    const ast: InvoiceTemplateAst = {
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      bindings: {
        values: {},
        collections: {
          lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
        },
      },
      transforms: {
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.grouped',
        operations: [
          {
            id: 'group-category',
            type: 'group',
            key: 'category',
          },
          {
            id: 'aggregate-total',
            type: 'aggregate',
            aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }],
          },
        ],
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'grouped-line-items',
            type: 'dynamic-table',
            repeat: {
              sourceBinding: { bindingId: 'lineItems.grouped' },
              itemBinding: 'item',
            },
            columns: [
              { id: 'group-key', header: 'Category', value: { type: 'path', path: 'key' } },
              { id: 'group-total', header: 'Total', value: { type: 'path', path: 'aggregates.sumTotal' } },
              { id: 'group-items', header: 'Items', value: { type: 'path', path: 'items.length' } },
            ],
          },
        ],
      },
    };

    const evaluation = evaluateInvoiceTemplateAst(ast, groupedInvoiceFixture);
    const rendered = await renderEvaluatedInvoiceTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('Services');
    expect(rendered.html).toContain('Products');
    expect(rendered.html).toContain('300');
    expect(rendered.html).toContain('30');
    expect(rendered.html).toContain('2');
    expect(rendered.html).toContain('1');
  });

  it('applies class tokens and style declarations consistently', async () => {
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
    const rendered = await renderEvaluatedInvoiceTemplateAst(ast, evaluation);

    expect(rendered.css).toContain('.ast-heading');
    expect(rendered.css).toContain('--brand-color');
    expect(rendered.html).toMatch(/class="[^"]*ast-heading[^"]*"/);
    expect(rendered.html).toContain('font-size:20px');
  });

  it('synthesizes printable inset padding for explicit print settings when the AST lacks a padded page wrapper', async () => {
    const ast: InvoiceTemplateAst = {
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      metadata: {
        printSettings: {
          paperPreset: 'Letter',
          marginMm: 12,
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        style: {
          inline: {
            width: '816px',
            height: '1056px',
          },
        },
        children: [
          {
            id: 'headline',
            type: 'text',
            content: { type: 'literal', value: 'Preview respects margin' },
          },
        ],
      },
    };

    const evaluation = evaluateInvoiceTemplateAst(ast, invoiceFixture);
    const rendered = await renderEvaluatedInvoiceTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('padding:45px');
    expect(rendered.html).toContain('box-sizing:border-box');
    expect(rendered.html).toContain('Preview respects margin');
  });

  it('does not synthesize printable inset padding when the AST already has a padded page wrapper', async () => {
    const ast: InvoiceTemplateAst = {
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      metadata: {
        printSettings: {
          paperPreset: 'Letter',
          marginMm: 12,
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        style: {
          inline: {
            width: '816px',
            height: '1056px',
          },
        },
        children: [
          {
            id: 'page-root',
            type: 'section',
            style: {
              inline: {
                width: '816px',
                height: '1056px',
                padding: '45px',
              },
            },
            children: [
              {
                id: 'headline',
                type: 'text',
                content: { type: 'literal', value: 'Existing page padding wins' },
              },
            ],
          },
        ],
      },
    };

    const evaluation = evaluateInvoiceTemplateAst(ast, invoiceFixture);
    const rendered = await renderEvaluatedInvoiceTemplateAst(ast, evaluation);

    expect(rendered.html).not.toContain('box-sizing:border-box');
    expect(rendered.html).toContain('padding:45px');
    expect(rendered.html).toContain('Existing page padding wins');
  });

  it('escapes unsafe text content in rendered HTML', async () => {
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
    const rendered = await renderEvaluatedInvoiceTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(rendered.html).not.toContain('<script>alert("xss")</script>');
  });

  it('sanitizes unexpected style identifiers (defense-in-depth) to avoid malformed CSS output', async () => {
    const ast = {
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      styles: {
        tokens: {
          // Both the record key and token.id are "unexpected" identifiers; renderer must still emit safe CSS.
          'token.bad': { id: 'token.bad', value: '#ff0000' },
        },
        classes: {
          'bad.class': {
            color: 'var(--token-bad)',
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
              tokenIds: ['bad.class'],
            },
            content: { type: 'literal', value: 'Styled title' },
          },
        ],
      },
    } as any;

    const evaluation: InvoiceTemplateEvaluationResult = {
      sourceCollection: [],
      output: [],
      groups: null,
      aggregates: {},
      totals: {},
      bindings: {},
    };

    const rendered = await renderEvaluatedInvoiceTemplateAst(ast, evaluation);

    expect(rendered.css).toContain('.ast-bad-class');
    expect(rendered.css).not.toContain('.ast-bad.class');
    expect(rendered.css).toContain('--token-bad:');
    expect(rendered.css).not.toContain('--token.bad:');
    expect(rendered.html).toMatch(/class="[^"]*ast-bad-class[^"]*"/);
  });

  it('omits image nodes when source resolves to null or empty-like values', async () => {
    const ast: InvoiceTemplateAst = {
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      bindings: {
        values: {
          logo: {
            id: 'logo',
            kind: 'value',
            path: 'tenantClient.logoUrl',
          },
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'issuer-logo',
            type: 'image',
            src: { type: 'binding', bindingId: 'logo' },
            alt: { type: 'literal', value: 'Tenant logo' },
          },
        ],
      },
    };

    const nullLogoEvaluation = evaluateInvoiceTemplateAst(ast, {
      ...invoiceFixture,
      tenantClient: { logoUrl: null },
    });
    const nullLogoRendered = await renderEvaluatedInvoiceTemplateAst(ast, nullLogoEvaluation);
    expect(nullLogoRendered.html).not.toContain('<img');

    const stringNullEvaluation = evaluateInvoiceTemplateAst(ast, {
      ...invoiceFixture,
      tenantClient: { logoUrl: 'null' },
    });
    const stringNullRendered = await renderEvaluatedInvoiceTemplateAst(ast, stringNullEvaluation);
    expect(stringNullRendered.html).not.toContain('<img');

    const emptyEvaluation = evaluateInvoiceTemplateAst(ast, {
      ...invoiceFixture,
      tenantClient: { logoUrl: '   ' },
    });
    const emptyRendered = await renderEvaluatedInvoiceTemplateAst(ast, emptyEvaluation);
    expect(emptyRendered.html).not.toContain('<img');
  });
});
