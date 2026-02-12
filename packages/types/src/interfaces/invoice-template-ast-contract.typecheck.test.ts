import { describe, expect, it } from 'vitest';
import type { IInvoiceTemplate } from './invoice.interfaces';
import { INVOICE_TEMPLATE_AST_VERSION } from '../lib/invoice-template-ast';

describe('IInvoiceTemplate AST contract', () => {
  it('accepts canonical templateAst payload without requiring legacy AssemblyScript source', () => {
    const template: IInvoiceTemplate = {
      template_id: 'tpl-ast',
      name: 'AST Template',
      version: 1,
      templateAst: {
        kind: 'invoice-template-ast',
        version: INVOICE_TEMPLATE_AST_VERSION,
        layout: {
          id: 'root',
          type: 'document',
          children: [],
        },
      },
      isStandard: false,
    };

    expect(template.templateAst?.kind).toBe('invoice-template-ast');
    expect(template.assemblyScriptSource).toBeUndefined();
  });
});
