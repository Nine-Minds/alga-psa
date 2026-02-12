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
});
