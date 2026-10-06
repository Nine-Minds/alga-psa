import { describe, expect, it } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';

import { evaluateTemplateAst } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';
import { validateTemplateAst } from './schema';

// alga-2026-0002383 PDF polish: headings keep with what follows, totals stay on
// one page, and an informational totals row with nothing to report is omitted.
const buildAst = (optionalTotal: number): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: { templateName: 'Print behaviour' },
  bindings: {
    values: {
      subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
      total: { id: 'total', kind: 'value', path: 'total_amount' },
      optionalTotal: { id: 'optionalTotal', kind: 'value', path: 'optional_total' },
    },
    collections: {
      lineItems: { id: 'lineItems', kind: 'collection', path: 'line_items' },
    },
  },
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'band-header',
        type: 'stack',
        direction: 'column',
        style: { inline: { breakAfter: 'avoid' } },
        children: [{ id: 'band-name', type: 'text', content: { type: 'literal', value: 'Monthly' } }],
      },
      {
        id: 'items-section',
        type: 'section',
        title: { i18nKey: 'labels.lineItems', defaultValue: 'Line items' },
        children: [{ id: 'note', type: 'text', content: { type: 'literal', value: 'Rows' } }],
      },
      {
        id: 'totals-wrap',
        type: 'stack',
        direction: 'row',
        style: { inline: { breakInside: 'avoid' } },
        children: [
          {
            id: 'totals',
            type: 'totals',
            sourceBinding: { bindingId: 'lineItems' },
            rows: [
              { id: 'subtotal', label: { i18nKey: 'labels.subtotal', defaultValue: 'Subtotal' }, value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
              { id: 'grand-total', label: { i18nKey: 'labels.total', defaultValue: 'Total' }, value: { type: 'binding', bindingId: 'total' }, format: 'currency', emphasize: true },
              { id: 'optional-total', label: { i18nKey: 'labels.optionalTotal', defaultValue: 'Optional if selected' }, value: { type: 'binding', bindingId: 'optionalTotal' }, format: 'currency', hideWhenZero: true },
            ],
          },
        ],
      },
    ],
  },
});

const data = (optionalTotal: number) => ({
  subtotal: 80454,
  total_amount: 80454,
  optional_total: optionalTotal,
  line_items: [],
  currency_code: 'USD',
});

const render = async (optionalTotal: number) => {
  const ast = buildAst(optionalTotal);
  const evaluation = evaluateTemplateAst(ast, data(optionalTotal));
  return renderEvaluatedTemplateAst(ast, evaluation, { locale: 'en-US' });
};

describe('template print behaviour', () => {
  it('accepts fragmentation hints and the hideWhenZero totals flag in the schema', () => {
    expect(() => validateTemplateAst(buildAst(0))).not.toThrow();
  });

  it('emits keep-with-next on headings and keep-together on totals', async () => {
    const { html, css } = await render(9540);
    expect(html).toMatch(/id="band-header"[^>]*style="[^"]*break-after:\s*avoid/);
    expect(html).toMatch(/id="totals-wrap"[^>]*style="[^"]*break-inside:\s*avoid/);
    // Renderer-level rules: section headings never orphan; totals never split.
    expect(css).toMatch(/section > h2 \{ break-after: avoid; \}/);
    expect(css).toMatch(/\.ast-node-type-totals \{ break-inside: avoid; \}/);
  });

  it('omits a hideWhenZero totals row when its value is zero and keeps it otherwise', async () => {
    const withOptionals = await render(9540);
    expect(withOptionals.html).toContain('Optional if selected');
    expect(withOptionals.html).toContain('$95.40');

    const without = await render(0);
    expect(without.html).not.toContain('Optional if selected');
    expect(without.html).not.toContain('$0.00');
    // Rows without the flag still print at zero.
    expect(without.html).toContain('Subtotal');
  });
});
