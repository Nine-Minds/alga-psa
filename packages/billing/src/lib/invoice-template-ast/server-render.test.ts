import { describe, expect, it } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';
import { evaluateTemplateAst } from './evaluator';
import { renderTemplateAstHtmlDocument } from './server-render';

describe('renderTemplateAstHtmlDocument', () => {
  it('returns a full HTML document wrapper for server/headless PDF rendering', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
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

    const evaluation = evaluateTemplateAst(ast, {
      invoiceNumber: 'INV-1001',
      items: [],
    });
    const htmlDocument = await renderTemplateAstHtmlDocument(ast, evaluation, {
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
