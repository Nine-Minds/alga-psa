import { describe, expect, it } from 'vitest';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';
import { validateInvoiceTemplateAst } from './schema';

describe('invoiceTemplateAstSchema', () => {
  it('validates a minimal AST document', () => {
    const result = validateInvoiceTemplateAst({
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      layout: {
        id: 'root',
        type: 'document',
        children: [],
      },
    });

    expect(result.success).toBe(true);
  });

  it('returns structured validation errors for invalid AST payloads', () => {
    const result = validateInvoiceTemplateAst({
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      layout: {
        id: 'root',
        type: 'unknown-node-type',
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toEqual(
      expect.objectContaining({
        code: expect.any(String),
        path: expect.any(String),
        message: expect.any(String),
      })
    );
  });

  it('requires repeat binding metadata for dynamic-table nodes', () => {
    const invalidResult = validateInvoiceTemplateAst({
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'line-items',
            type: 'dynamic-table',
            repeat: {
              sourceBinding: { bindingId: 'invoice.items' },
            },
            columns: [
              {
                id: 'description',
                value: { type: 'path', path: 'description' },
              },
            ],
          },
        ],
      },
    });

    expect(invalidResult.success).toBe(false);
    if (invalidResult.success) {
      return;
    }
    expect(invalidResult.errors.some((error) => error.path.includes('repeat.itemBinding'))).toBe(true);

    const validResult = validateInvoiceTemplateAst({
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'line-items',
            type: 'dynamic-table',
            repeat: {
              sourceBinding: { bindingId: 'invoice.items' },
              itemBinding: 'item',
            },
            columns: [
              {
                id: 'description',
                value: { type: 'path', path: 'description' },
              },
            ],
          },
        ],
      },
    });

    expect(validResult.success).toBe(true);
  });

  it('enforces transform payload shapes for filter/sort/group/aggregate/computed workflows', () => {
    const invalidTransformPayload = validateInvoiceTemplateAst({
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      transforms: {
        sourceBindingId: 'invoice.items',
        outputBindingId: 'invoice.items.shaped',
        operations: [
          {
            id: 'sort-1',
            type: 'sort',
            keys: [],
          },
        ],
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [],
      },
    });

    expect(invalidTransformPayload.success).toBe(false);
    if (invalidTransformPayload.success) {
      return;
    }
    expect(invalidTransformPayload.errors.some((error) => error.path.includes('transforms.operations.0.keys'))).toBe(true);

    const validTransformPayload = validateInvoiceTemplateAst({
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      transforms: {
        sourceBindingId: 'invoice.items',
        outputBindingId: 'invoice.items.shaped',
        operations: [
          {
            id: 'filter-1',
            type: 'filter',
            predicate: {
              type: 'comparison',
              path: 'quantity',
              op: 'gt',
              value: 0,
            },
          },
          {
            id: 'sort-1',
            type: 'sort',
            keys: [
              {
                path: 'description',
                direction: 'asc',
              },
            ],
          },
          {
            id: 'group-1',
            type: 'group',
            key: 'category',
          },
          {
            id: 'aggregate-1',
            type: 'aggregate',
            aggregations: [
              {
                id: 'sum-total',
                op: 'sum',
                path: 'total',
              },
            ],
          },
          {
            id: 'computed-1',
            type: 'computed-field',
            fields: [
              {
                id: 'lineTotal',
                expression: {
                  type: 'binary',
                  op: 'multiply',
                  left: { type: 'path', path: 'quantity' },
                  right: { type: 'path', path: 'unitPrice' },
                },
              },
            ],
          },
        ],
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [],
      },
    });

    expect(validTransformPayload.success).toBe(true);
  });

  it('accepts optional strategyId on transform operations', () => {
    const result = validateInvoiceTemplateAst({
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      transforms: {
        sourceBindingId: 'invoice.items',
        outputBindingId: 'invoice.items.grouped',
        operations: [
          {
            id: 'group-1',
            type: 'group',
            key: 'category',
            strategyId: 'custom-group-key',
          },
          {
            id: 'aggregate-1',
            type: 'aggregate',
            strategyId: 'custom-aggregate',
            aggregations: [
              {
                id: 'sum-total',
                op: 'sum',
                path: 'total',
              },
            ],
          },
        ],
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [],
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid CSS identifiers in styles.classes keys', () => {
    const result = validateInvoiceTemplateAst({
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      styles: {
        classes: {
          // `.` is not allowed by the safe identifier rule.
          'bad.class': { color: 'red' },
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [],
      },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((error) => error.message.includes('Invalid CSS identifier'))).toBe(true);
  });
});
