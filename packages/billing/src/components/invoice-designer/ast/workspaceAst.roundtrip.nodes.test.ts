import type { InvoiceTemplateValueExpression } from '@alga-psa/types';
import { describe, expect, it } from 'vitest';
import { createAstDocument, findNodeById, getDocumentNode, roundTripAst } from './workspaceAst.roundtrip.helpers';

describe('workspaceAst roundtrip node/property matrix', () => {
  it('round-trips all text expression variants', () => {
    const expressionMatrix: Array<{ id: string; expression: InvoiceTemplateValueExpression }> = [
      { id: 'text-literal-string', expression: { type: 'literal', value: 'Invoice' } },
      { id: 'text-literal-number', expression: { type: 'literal', value: 42 } },
      { id: 'text-literal-bool', expression: { type: 'literal', value: true } },
      { id: 'text-literal-null', expression: { type: 'literal', value: null } },
      { id: 'text-binding', expression: { type: 'binding', bindingId: 'tenantClientName' } },
      { id: 'text-path', expression: { type: 'path', path: 'customer.name' } },
      {
        id: 'text-template',
        expression: {
          type: 'template',
          template: '{{first}} {{last}}',
          args: {
            first: { type: 'binding', bindingId: 'firstName' },
            last: { type: 'binding', bindingId: 'lastName' },
          },
        },
      },
    ];

    const ast = createAstDocument(
      [
        {
          id: 'page-section',
          type: 'section',
          children: expressionMatrix.map((entry) => ({
            id: entry.id,
            type: 'text',
            content: entry.expression,
          })),
        },
      ],
      {
        bindings: {
          values: {
            tenantClientName: { id: 'tenantClientName', kind: 'value', path: 'tenantClient.name' },
            firstName: { id: 'firstName', kind: 'value', path: 'customer.firstName' },
            lastName: { id: 'lastName', kind: 'value', path: 'customer.lastName' },
          },
          collections: {},
        },
      }
    );

    const roundTripped = roundTripAst(ast);
    const layout = getDocumentNode(roundTripped);
    for (const entry of expressionMatrix) {
      const node = findNodeById(layout, entry.id);
      expect(node?.type).toBe('text');
      if (!node || node.type !== 'text') continue;
      expect(node.content).toEqual(entry.expression);
    }
  });

  it('round-trips section, stack, image, and divider properties', () => {
    const ast = createAstDocument([
      {
        id: 'page-section',
        type: 'section',
        children: [
          {
            id: 'invoice-section',
            type: 'section',
            title: 'Invoice Header',
            style: {
              tokenIds: ['card'],
              inline: {
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '16px',
              },
            },
            children: [
              {
                id: 'header-stack',
                type: 'stack',
                direction: 'row',
                style: {
                  inline: {
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                  },
                },
                children: [
                  {
                    id: 'logo',
                    type: 'image',
                    src: { type: 'binding', bindingId: 'tenantClientLogo' },
                    alt: { type: 'template', template: '{{name}} logo', args: { name: { type: 'binding', bindingId: 'tenantClientName' } } },
                    style: {
                      inline: {
                        width: '120px',
                        maxHeight: '64px',
                      },
                    },
                  },
                  {
                    id: 'divider',
                    type: 'divider',
                    style: {
                      inline: { margin: '8px 0' },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ], {
      bindings: {
        values: {
          tenantClientName: { id: 'tenantClientName', kind: 'value', path: 'tenantClient.name' },
          tenantClientLogo: { id: 'tenantClientLogo', kind: 'value', path: 'tenantClient.logoUrl' },
        },
        collections: {},
      },
    });

    const roundTripped = roundTripAst(ast);
    const layout = getDocumentNode(roundTripped);

    const section = findNodeById(layout, 'invoice-section');
    expect(section?.type).toBe('section');
    if (!section || section.type !== 'section') return;
    expect(section.title).toBe('Invoice Header');
    expect(section.style?.tokenIds).toEqual(['card']);
    expect(section.style?.inline).toMatchObject({
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      padding: '16px',
    });

    const stack = findNodeById(layout, 'header-stack');
    expect(stack?.type).toBe('stack');
    if (!stack || stack.type !== 'stack') return;
    expect(stack.direction).toBe('row');
    expect(stack.style?.inline).toMatchObject({
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '12px',
    });

    const image = findNodeById(layout, 'logo');
    expect(image?.type).toBe('image');
    if (!image || image.type !== 'image') return;
    expect(image.src).toEqual({ type: 'binding', bindingId: 'tenantClientLogo' });
    expect(image.alt).toEqual({
      type: 'template',
      template: '{{name}} logo',
      args: { name: { type: 'binding', bindingId: 'tenantClientName' } },
    });
    expect(image.style?.inline).toMatchObject({
      width: '120px',
      maxHeight: '64px',
    });

    const divider = findNodeById(layout, 'divider');
    expect(divider?.type).toBe('divider');
    if (!divider || divider.type !== 'divider') return;
    expect(divider.style?.inline).toMatchObject({ margin: '8px 0' });
  });

  it('round-trips field properties including optional format and emptyValue', () => {
    const ast = createAstDocument(
      [
        {
          id: 'field-section',
          type: 'section',
          children: [
            {
              id: 'field-explicit',
              type: 'field',
              binding: { bindingId: 'issueDate' },
              label: 'Issue Date',
              format: 'date',
              emptyValue: '-',
            },
            {
              id: 'field-implicit',
              type: 'field',
              binding: { bindingId: 'invoiceNumber' },
              label: 'Invoice #',
            },
          ],
        },
      ],
      {
        bindings: {
          values: {
            issueDate: { id: 'issueDate', kind: 'value', path: 'issueDate' },
            invoiceNumber: { id: 'invoiceNumber', kind: 'value', path: 'invoiceNumber' },
          },
          collections: {},
        },
      }
    );

    const roundTripped = roundTripAst(ast);
    const layout = getDocumentNode(roundTripped);

    const explicitField = findNodeById(layout, 'field-explicit');
    expect(explicitField?.type).toBe('field');
    if (!explicitField || explicitField.type !== 'field') return;
    expect(explicitField.binding).toEqual({ bindingId: 'issueDate' });
    expect(explicitField.label).toBe('Issue Date');
    expect(explicitField.format).toBe('date');
    expect(explicitField.emptyValue).toBe('-');

    const implicitField = findNodeById(layout, 'field-implicit');
    expect(implicitField?.type).toBe('field');
    if (!implicitField || implicitField.type !== 'field') return;
    expect(implicitField.binding).toEqual({ bindingId: 'invoiceNumber' });
    expect(implicitField.label).toBe('Invoice #');
    expect(Object.prototype.hasOwnProperty.call(implicitField, 'format')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(implicitField, 'emptyValue')).toBe(false);
  });

  it('round-trips dynamic-table columns including style and emptyStateText', () => {
    const ast = createAstDocument(
      [
        {
          id: 'line-items',
          type: 'dynamic-table',
          repeat: {
            sourceBinding: { bindingId: 'lineItems' },
            itemBinding: 'line',
            keyPath: 'id',
          },
          emptyStateText: 'No line items',
          columns: [
            {
              id: 'description',
              header: 'Description',
              value: { type: 'path', path: 'description' },
            },
            {
              id: 'qty',
              header: 'Qty',
              value: { type: 'path', path: 'quantity' },
              format: 'number',
              style: { inline: { textAlign: 'right' } },
            },
            {
              id: 'amount',
              header: 'Amount',
              value: { type: 'path', path: 'total' },
              format: 'currency',
              style: {
                tokenIds: ['currency-col'],
                inline: { textAlign: 'right', fontWeight: 600 },
              },
            },
          ],
        },
      ],
      {
        bindings: {
          values: {},
          collections: {
            lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
          },
        },
      }
    );

    const roundTripped = roundTripAst(ast);
    const layout = getDocumentNode(roundTripped);
    const table = findNodeById(layout, 'line-items');
    expect(table?.type).toBe('dynamic-table');
    if (!table || table.type !== 'dynamic-table') return;

    expect(table.repeat.sourceBinding.bindingId).toBe('lineItems');
    expect(table.repeat.itemBinding).toBe('item');
    expect(table.emptyStateText).toBe('No line items');
    expect(table.columns).toHaveLength(3);
    expect(table.columns[1]).toMatchObject({
      id: 'qty',
      header: 'Qty',
      value: { type: 'path', path: 'quantity' },
      format: 'number',
      style: { inline: { textAlign: 'right' } },
    });
    expect(table.columns[2]).toMatchObject({
      id: 'amount',
      header: 'Amount',
      value: { type: 'path', path: 'total' },
      format: 'currency',
      style: {
        tokenIds: ['currency-col'],
        inline: { textAlign: 'right', fontWeight: 600 },
      },
    });
  });

  it('round-trips totals rows with expression, format, and emphasize', () => {
    const ast = createAstDocument(
      [
        {
          id: 'totals',
          type: 'totals',
          sourceBinding: { bindingId: 'lineItems' },
          rows: [
            { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
            { id: 'tax', label: 'Tax', value: { type: 'path', path: 'tax' }, format: 'currency' },
            { id: 'total', label: 'Total', value: { type: 'literal', value: 123.45 }, format: 'number', emphasize: true },
          ],
        },
      ],
      {
        bindings: {
          values: {
            subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
          },
          collections: {
            lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
          },
        },
      }
    );

    const roundTripped = roundTripAst(ast);
    const layout = getDocumentNode(roundTripped);
    const totals = findNodeById(layout, 'totals');
    expect(totals?.type).toBe('totals');
    if (!totals || totals.type !== 'totals') return;

    expect(totals.sourceBinding.bindingId).toBe('lineItems');
    expect(totals.rows).toEqual([
      { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
      { id: 'tax', label: 'Tax', value: { type: 'path', path: 'tax' }, format: 'currency' },
      { id: 'total', label: 'Total', value: { type: 'literal', value: 123.45 }, format: 'number', emphasize: true },
    ]);
  });

  it('keeps explicit top-level section wrappers and avoids synthetic wrapper leaks', () => {
    const explicitSectionAst = createAstDocument([
      {
        id: 'page-section',
        type: 'section',
        children: [{ id: 'headline', type: 'text', content: { type: 'literal', value: 'Hello' } }],
      },
    ]);

    const roundTrippedExplicit = roundTripAst(explicitSectionAst);
    const explicitLayout = getDocumentNode(roundTrippedExplicit);
    expect(explicitLayout.children.map((child) => child.id)).toEqual(['page-section']);
    expect(explicitLayout.children[0]?.type).toBe('section');

    const syntheticWrapperAst = createAstDocument([
      {
        id: 'top-stack',
        type: 'stack',
        direction: 'column',
        children: [{ id: 'body', type: 'text', content: { type: 'literal', value: 'Body' } }],
      },
    ]);

    const roundTrippedSynthetic = roundTripAst(syntheticWrapperAst);
    const syntheticLayout = getDocumentNode(roundTrippedSynthetic);
    expect(syntheticLayout.children.map((child) => child.id)).toEqual(['top-stack']);
    expect(syntheticLayout.children[0]?.type).toBe('stack');
  });
});
