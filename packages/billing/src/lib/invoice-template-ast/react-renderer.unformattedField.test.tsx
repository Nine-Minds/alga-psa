import { describe, expect, it } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';

import { evaluateTemplateAst } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';

// alga0002295 plan §5.1: a palette Subtotal Row exports as a `field` node. When its
// schema default sets no `format`, the field format defaults to `text`.
const buildAst = (format?: 'currency'): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: { templateName: 'Unformatted subtotal' },
  bindings: { values: { subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' } } },
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'subtotal-row',
        type: 'field',
        binding: { bindingId: 'subtotal' },
        label: { i18nKey: 'labels.subtotal', defaultValue: 'Subtotal' },
        ...(format ? { format } : {}),
      } as any,
    ],
  },
});

const render = async (format?: 'currency') => {
  const ast = buildAst(format);
  const evaluation = evaluateTemplateAst(ast, { subtotal: 120000, currencyCode: 'EUR', currency_code: 'EUR' });
  return renderEvaluatedTemplateAst(ast, evaluation, { locale: 'en-US' });
};

describe('unformatted subtotal field (alga0002295 §5.1)', () => {
  it('records how a field with no format renders minor units', async () => {
    const { html } = await render();
    expect(html).toContain('120000');
    expect(html).not.toContain('1,200.00');
  });

  it('renders money when format is currency, using the view-model currency', async () => {
    const { html } = await render('currency');
    expect(html).toContain('€1,200.00');
  });
});
