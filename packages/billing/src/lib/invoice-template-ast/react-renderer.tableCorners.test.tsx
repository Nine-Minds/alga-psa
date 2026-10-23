import { describe, expect, it } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';
import { evaluateTemplateAst } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';

const tableAst = (inline: Record<string, string>): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  bindings: { values: {}, collections: { lineItems: { id: 'lineItems', kind: 'collection', path: 'items' } } },
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'line-items',
        type: 'dynamic-table',
        style: { inline },
        repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
        columns: [{ id: 'description', header: 'Description', value: { type: 'path', path: 'description' } }],
      },
    ],
  },
});

const render = async (ast: TemplateAst) =>
  renderEvaluatedTemplateAst(ast, evaluateTemplateAst(ast, { items: [{ description: 'Consulting' }] }));

describe('table corner rendering', () => {
  it('renders an authored radius by drawing the table with separate borders', async () => {
    const rendered = await render(tableAst({ border: '1px solid #e5e7eb', borderRadius: '10px' }));
    expect(rendered.html).toMatch(/<table id="line-items"[^>]*style="[^"]*border-collapse:separate/);
    expect(rendered.html).toMatch(/<table id="line-items"[^>]*style="[^"]*border-radius:10px/);
  });

  it('leaves square tables on the collapsed-border default', async () => {
    const rendered = await render(tableAst({ border: '1px solid #e5e7eb' }));
    expect(rendered.html).not.toMatch(/border-collapse:separate/);
  });
});
