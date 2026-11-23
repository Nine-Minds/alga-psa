import { describe, expect, it } from 'vitest';
import { prepareHtmlForIsolatedRendering } from '@alga-psa/core/rendering/isolatedRendering';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';
import { evaluateTemplateAst } from './evaluator';
import { DOCUMENT_PRINT_GEOMETRY_CSS } from './printSettings';
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
    expect(htmlDocument).toMatch(/<p id="title"[^>]*>Invoice<\/p>/);
  });

  it('renders a repeating stack with nested dynamic-table bound to the current iteration via scope', async () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      bindings: {
        collections: {
          groupsByLocation: { id: 'groupsByLocation', kind: 'collection', path: 'groupsByLocation' },
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
              { id: 'band-header', type: 'text', content: { type: 'path', path: 'name' } },
              {
                id: 'band-items',
                type: 'dynamic-table',
                repeat: { sourceBinding: { bindingId: 'group.items' }, itemBinding: 'item' },
                columns: [
                  { id: 'description', header: 'Description', value: { type: 'path', path: 'description' } },
                ],
              },
            ],
          },
        ],
      },
    };

    const evaluation = evaluateTemplateAst(ast, {
      invoiceNumber: 'INV-2002',
      items: [],
      groupsByLocation: [
        {
          location_id: 'loc-1',
          name: 'Site A',
          subtotal: 100,
          items: [{ id: 'a1', description: 'Site A item', quantity: 1, unitPrice: 100, total: 100 }],
        },
        {
          location_id: 'loc-2',
          name: 'Site B',
          subtotal: 50,
          items: [{ id: 'b1', description: 'Site B item', quantity: 1, unitPrice: 50, total: 50 }],
        },
      ],
    });

    const htmlDocument = await renderTemplateAstHtmlDocument(ast, evaluation, {
      title: 'Invoice INV-2002',
    });

    expect(htmlDocument).toContain('Site A');
    expect(htmlDocument).toContain('Site B');
    expect(htmlDocument).toContain('Site A item');
    expect(htmlDocument).toContain('Site B item');
  });

  describe('print geometry', () => {
    const ast: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      metadata: { printSettings: { paperPreset: 'Letter', marginMm: 10.58 } },
      layout: {
        id: 'root',
        type: 'document',
        style: { inline: { width: '816px', height: '1056px' } },
        children: [{ id: 'title', type: 'text', content: { type: 'literal', value: 'Invoice' } }],
      },
    };

    const render = (printGeometry?: 'document' | 'label-cell') =>
      renderTemplateAstHtmlDocument(ast, evaluateTemplateAst(ast, {}), { title: 'Invoice', printGeometry });

    it('strips the markup of its own page margin and page width, for print only', async () => {
      const htmlDocument = await render();

      // On screen the root is still the page-sized sheet the designer drew, with the margin
      // padded into it; the page box takes both over once the document reaches paper.
      expect(htmlDocument).toMatch(/id="root"[^>]*style="[^"]*padding:\s*40px/);
      expect(htmlDocument).toContain(DOCUMENT_PRINT_GEOMETRY_CSS);
    });

    it('survives the asset-isolation rewrite the PDF path runs it through', async () => {
      // pdfGenerationService re-serializes every stylesheet through a CSSOM before printing.
      // A rule that does not survive that pass never reaches paper, however well it tests here.
      const isolated = await prepareHtmlForIsolatedRendering(await render());

      expect(isolated).toMatch(/@media print \{[^}]*html, body \{margin: 0; padding: 0;\}/);
      expect(isolated).toMatch(/\.ast-node-type-document \{[^}]*padding: 0 !important;/);
    });

    it('leaves a label cell its own margin', async () => {
      // A label's margin IS the renderer's root padding: composeLabelSheets positions the cell
      // with no padding of its own, so stripping it would print the label against its own edge.
      expect(await render('label-cell')).not.toContain(DOCUMENT_PRINT_GEOMETRY_CSS);
    });
  });
});
