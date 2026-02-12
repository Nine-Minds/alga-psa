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
});
