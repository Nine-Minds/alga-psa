import { describe, expect, it } from 'vitest';
import type { InvoiceTemplateAst } from '@alga-psa/types';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';
import { evaluateInvoiceTemplateAst } from './evaluator';
import { renderInvoiceTemplateAstHtmlDocument } from './server-render';

describe('renderInvoiceTemplateAstHtmlDocument', () => {
  it('returns a full HTML document wrapper for server/headless PDF rendering', async () => {
    const ast: InvoiceTemplateAst = {
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'title',
            type: 'text',
            content: { type: 'literal', value: 'Invoice' },
          },
        ],
      },
    };

    const evaluation = evaluateInvoiceTemplateAst(ast, {
      invoiceNumber: 'INV-1001',
      items: [],
    });
    const htmlDocument = await renderInvoiceTemplateAstHtmlDocument(ast, evaluation, {
      title: 'Invoice INV-1001',
      bodyClassName: 'pdf-body',
      additionalCss: '.pdf-body { margin: 0; }',
    });

    expect(htmlDocument).toContain('<!doctype html>');
    expect(htmlDocument).toContain('<html');
    expect(htmlDocument).toContain('<head>');
    expect(htmlDocument).toContain('<body class="pdf-body">');
    expect(htmlDocument).toContain('<style>');
    expect(htmlDocument).toContain('.pdf-body { margin: 0; }');
    expect(htmlDocument).toContain('Invoice INV-1001');
    expect(htmlDocument).toContain('<p id="title">Invoice</p>');
  });
});
