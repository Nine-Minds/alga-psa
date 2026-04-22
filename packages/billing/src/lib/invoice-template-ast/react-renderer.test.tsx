import { describe, expect, it } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';
import type { TemplateEvaluationResult } from './evaluator';
import { evaluateTemplateAst } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';

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

describe('renderEvaluatedTemplateAst', () => {
  it('renders HTML for text/field/table/totals node combinations', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
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

    const evaluation = evaluateTemplateAst(ast, invoiceFixture);
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('Invoice INV-1001');
    expect(rendered.html).toContain('Invoice #');
    expect(rendered.html).toContain('Consulting');
    expect(rendered.html).toContain('Support');
    expect(rendered.html).toContain('Grand Total');
    expect(rendered.html).toContain('300');
  });

  it('renders multiline address fields with preserved line breaks', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      bindings: {
        values: {
          tenantAddress: { id: 'tenantAddress', kind: 'value', path: 'tenantClient.address' },
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'issuer-address',
            type: 'field',
            binding: { bindingId: 'tenantAddress' },
            displayFormat: 'multiline',
          },
        ],
      },
    };

    const evaluation = evaluateTemplateAst(ast, {
      ...invoiceFixture,
      tenantClient: { address: '400 SW Main St, Portland, OR 97204' },
    });
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('400 SW Main St');
    expect(rendered.html).toContain('Portland');
    expect(rendered.html).toContain('white-space:pre-line');
  });

  it('renders field border styles in preview output', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      bindings: {
        values: {
          invoiceNumber: { id: 'invoiceNumber', kind: 'value', path: 'invoiceNumber' },
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'invoice-number-boxed',
            type: 'field',
            binding: { bindingId: 'invoiceNumber' },
            borderStyle: 'box',
          },
          {
            id: 'invoice-number-underlined',
            type: 'field',
            binding: { bindingId: 'invoiceNumber' },
            borderStyle: 'underline',
          },
          {
            id: 'invoice-number-plain',
            type: 'field',
            binding: { bindingId: 'invoiceNumber' },
            borderStyle: 'none',
          },
        ],
      },
    };

    const evaluation = evaluateTemplateAst(ast, invoiceFixture);
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('border:1px solid #cbd5e1');
    expect(rendered.html).toContain('border-bottom:1px solid #cbd5e1');
    expect(rendered.html).toContain('padding:0');
    expect(rendered.html).toContain('border:0');
    expect(rendered.html).toContain('justify-content:space-between');
  });

  it('renders multiline plain fields without single-line inset chrome', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      bindings: {
        values: {
          customerAddress: { id: 'customerAddress', kind: 'value', path: 'customer.address' },
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'customer-address',
            type: 'field',
            binding: { bindingId: 'customerAddress' },
            borderStyle: 'none',
            displayFormat: 'multiline',
          },
        ],
      },
    };

    const evaluation = evaluateTemplateAst(ast, {
      ...invoiceFixture,
      customer: { address: '901 Harbor Ave, Seattle, WA 98104' },
    });
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('padding:0');
    expect(rendered.html).toContain('align-items:flex-start');
    expect(rendered.html).toContain('white-space:pre-line');
    expect(rendered.html).toContain('901 Harbor Ave');
  });

  it('does not render an underline when the field border style is none', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      bindings: {
        values: {
          invoiceNumber: { id: 'invoiceNumber', kind: 'value', path: 'invoiceNumber' },
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'invoice-number-plain',
            type: 'field',
            binding: { bindingId: 'invoiceNumber' },
            borderStyle: 'none',
          },
        ],
      },
    };

    const evaluation = evaluateTemplateAst(ast, invoiceFixture);
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('padding:0');
    expect(rendered.html).toContain('border:0');
    expect(rendered.html).not.toContain('border-bottom:1px solid #cbd5e1');
  });

  it('removes single-line inset padding for multiline underlined fields', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      bindings: {
        values: {
          customerAddress: { id: 'customerAddress', kind: 'value', path: 'customer.address' },
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'customer-address',
            type: 'field',
            binding: { bindingId: 'customerAddress' },
            borderStyle: 'underline',
            displayFormat: 'multiline',
          },
        ],
      },
    };

    const evaluation = evaluateTemplateAst(ast, {
      ...invoiceFixture,
      customer: { address: '901 Harbor Ave, Seattle, WA 98104' },
    });
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('padding:0');
    expect(rendered.html).toContain('border-bottom:1px solid #cbd5e1');
    expect(rendered.html).toContain('align-items:flex-start');
    expect(rendered.html).toContain('white-space:pre-line');
  });

  it('renders grouped dynamic-table rows from a transformed output binding', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
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

    const evaluation = evaluateTemplateAst(ast, {
      ...invoiceFixture,
      items: [
        { id: 'a', description: 'Consulting', category: 'Services', quantity: 2, unitPrice: 100, total: 200 },
        { id: 'b', description: 'Support', category: 'Services', quantity: 1, unitPrice: 100, total: 100 },
        { id: 'c', description: 'Equipment', category: 'Products', quantity: 1, unitPrice: 30, total: 30 },
      ],
    });
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('Group');
    expect(rendered.html).toContain('Rolled Up Total');
    expect(rendered.html).toContain('Services');
    expect(rendered.html).toContain('Products');
    expect(rendered.html).toContain('300');
    expect(rendered.html).toContain('30');
  });

  it('formats template path expressions using currency filter syntax', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
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

    const evaluation = evaluateTemplateAst(ast, invoiceFixture);
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

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
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
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

    const evaluation = evaluateTemplateAst(ast, groupedInvoiceFixture);
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('Services');
    expect(rendered.html).toContain('Products');
    expect(rendered.html).toContain('300');
    expect(rendered.html).toContain('30');
    expect(rendered.html).toContain('2');
    expect(rendered.html).toContain('1');
  });

  it('renders grouped dynamic-table rows when aggregate ids are produced across multiple aggregate steps', async () => {
    const groupedInvoiceFixture = {
      ...invoiceFixture,
      items: [
        { id: 'a', description: 'Consulting', quantity: 2, unitPrice: 100, total: 200, category: 'Services' },
        { id: 'b', description: 'Support', quantity: 1, unitPrice: 100, total: 100, category: 'Services' },
        { id: 'c', description: 'Hardware', quantity: 1, unitPrice: 30, total: 30, category: 'Products' },
      ],
    };
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
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
            id: 'aggregate-qty',
            type: 'aggregate',
            aggregations: [{ id: 'sumQty', op: 'sum', path: 'quantity' }],
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
              { id: 'group-qty', header: 'Qty', value: { type: 'path', path: 'aggregates.sumQty' }, format: 'number' },
              { id: 'group-total', header: 'Total', value: { type: 'path', path: 'aggregates.sumTotal' } },
            ],
          },
        ],
      },
    };

    const evaluation = evaluateTemplateAst(ast, groupedInvoiceFixture);
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('Services');
    expect(rendered.html).toContain('Products');
    expect(rendered.html).toContain('3');
    expect(rendered.html).toContain('1');
    expect(rendered.html).toContain('300');
    expect(rendered.html).toContain('30');
  });

  it('applies class tokens and style declarations consistently', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
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

    const evaluation = evaluateTemplateAst(ast, invoiceFixture);
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.css).toContain('.ast-heading');
    expect(rendered.css).toContain('--brand-color');
    expect(rendered.html).toMatch(/class="[^"]*ast-heading[^"]*"/);
    expect(rendered.html).toContain('font-size:20px');
  });

  it('synthesizes printable inset padding for explicit print settings when the AST lacks a padded page wrapper', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
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

    const evaluation = evaluateTemplateAst(ast, invoiceFixture);
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('padding:45px');
    expect(rendered.html).toContain('box-sizing:border-box');
    expect(rendered.html).toContain('Preview respects margin');
  });

  it('does not synthesize printable inset padding when the AST already has a padded page wrapper', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
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

    const evaluation = evaluateTemplateAst(ast, invoiceFixture);
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.html).not.toContain('box-sizing:border-box');
    expect(rendered.html).toContain('padding:45px');
    expect(rendered.html).toContain('Existing page padding wins');
  });

  it('escapes unsafe text content in rendered HTML', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
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

    const evaluation = evaluateTemplateAst(ast, invoiceFixture);
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(rendered.html).not.toContain('<script>alert("xss")</script>');
  });

  it('sanitizes unexpected style identifiers (defense-in-depth) to avoid malformed CSS output', async () => {
    const ast = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
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

    const evaluation: TemplateEvaluationResult = {
      sourceCollection: [],
      output: [],
      groups: null,
      aggregates: {},
      totals: {},
      bindings: {},
    };

    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(rendered.css).toContain('.ast-bad-class');
    expect(rendered.css).not.toContain('.ast-bad.class');
    expect(rendered.css).toContain('--token-bad:');
    expect(rendered.css).not.toContain('--token.bad:');
    expect(rendered.html).toMatch(/class="[^"]*ast-bad-class[^"]*"/);
  });

  it('renders a repeating stack once per source item with a nested dynamic-table scoped to the current item', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      bindings: {
        collections: {
          groupsByLocation: { id: 'groupsByLocation', kind: 'collection', path: 'groupsByLocation' },
          // Global `lineItems` on the invoice — must still resolve from the
          // global binding even when a scope is active, since no scope entry
          // shadows the name `lineItems`.
          lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'location-bands',
            type: 'stack',
            direction: 'column',
            repeat: { sourceBinding: { bindingId: 'groupsByLocation' }, itemBinding: 'group' },
            children: [
              {
                id: 'band-header',
                type: 'text',
                content: { type: 'path', path: 'name' },
              },
              {
                id: 'band-items',
                type: 'dynamic-table',
                repeat: { sourceBinding: { bindingId: 'group.items' }, itemBinding: 'item' },
                columns: [
                  { id: 'description', header: 'Description', value: { type: 'path', path: 'description' } },
                  { id: 'total', header: 'Total', value: { type: 'path', path: 'total' } },
                ],
              },
              {
                id: 'band-subtotal',
                type: 'text',
                content: { type: 'path', path: 'subtotal' },
              },
            ],
          },
          // A sibling global dynamic-table to confirm the plain `lineItems`
          // binding continues to resolve from globals (no scope interference).
          {
            id: 'global-line-items',
            type: 'dynamic-table',
            repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
            columns: [
              { id: 'description', header: 'Description', value: { type: 'path', path: 'description' } },
            ],
          },
        ],
      },
    };

    const evaluation = evaluateTemplateAst(ast, {
      items: [
        { id: 'global-a', description: 'Global Item A', quantity: 1, unitPrice: 100, total: 100 },
      ],
      groupsByLocation: [
        {
          location_id: 'loc-1',
          name: 'City Office',
          subtotal: 300,
          items: [
            { id: 'a', description: 'Site fee', quantity: 1, unitPrice: 200, total: 200 },
            { id: 'b', description: 'Endpoints', quantity: 5, unitPrice: 40, total: 200 },
          ],
        },
        {
          location_id: 'loc-2',
          name: 'Water Plant',
          subtotal: 240,
          items: [
            { id: 'c', description: 'Site fee', quantity: 1, unitPrice: 150, total: 150 },
          ],
        },
      ],
    });
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    // Band header content appears once per group.
    expect(rendered.html).toContain('City Office');
    expect(rendered.html).toContain('Water Plant');
    // Per-band items resolve via the scope-named `group.items` binding.
    expect(rendered.html).toContain('Site fee');
    expect(rendered.html).toContain('Endpoints');
    // Global lineItems binding still resolves from the top-level source.
    expect(rendered.html).toContain('Global Item A');
    // Per-band subtotals render as path values against the current group item.
    expect(rendered.html).toContain('300');
    expect(rendered.html).toContain('240');
    // Two band headers rendered — assert the band container opens twice as
    // many child text nodes as a single iteration would produce.
    const bandHeaderMatches = rendered.html.match(/id="band-header"/g) ?? [];
    expect(bandHeaderMatches.length).toBe(2);
    const bandItemsMatches = rendered.html.match(/id="band-items"/g) ?? [];
    expect(bandItemsMatches.length).toBe(2);
  });

  it('omits image nodes when source resolves to null or empty-like values', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
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

    const nullLogoEvaluation = evaluateTemplateAst(ast, {
      ...invoiceFixture,
      tenantClient: { logoUrl: null },
    });
    const nullLogoRendered = await renderEvaluatedTemplateAst(ast, nullLogoEvaluation);
    expect(nullLogoRendered.html).not.toContain('<img');

    const stringNullEvaluation = evaluateTemplateAst(ast, {
      ...invoiceFixture,
      tenantClient: { logoUrl: 'null' },
    });
    const stringNullRendered = await renderEvaluatedTemplateAst(ast, stringNullEvaluation);
    expect(stringNullRendered.html).not.toContain('<img');

    const emptyEvaluation = evaluateTemplateAst(ast, {
      ...invoiceFixture,
      tenantClient: { logoUrl: '   ' },
    });
    const emptyRendered = await renderEvaluatedTemplateAst(ast, emptyEvaluation);
    expect(emptyRendered.html).not.toContain('<img');
  });
});
