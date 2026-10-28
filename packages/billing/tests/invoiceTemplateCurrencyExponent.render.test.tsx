import { describe, expect, it } from 'vitest';
import { TEMPLATE_AST_VERSION, type TemplateAst } from '@alga-psa/types';

import { evaluateTemplateAst } from '../src/lib/invoice-template-ast/evaluator';
import { renderEvaluatedTemplateAst } from '../src/lib/invoice-template-ast/react-renderer';

/**
 * The rendered path (screen preview and the PDF, which goes through the same
 * renderer) formats currency itself, so the minor-unit exponent fix needs its
 * own guard here as well as in the designer's field formatter.
 */
const ast = {
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  bindings: { collections: { lineItems: { id: 'lineItems', kind: 'collection', path: 'items' } } },
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'line-items',
        type: 'dynamic-table',
        repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
        columns: [
          {
            id: 'service-period',
            header: { i18nKey: 'labels.servicePeriod', defaultValue: 'Service Period' },
            value: { type: 'path', path: 'servicePeriodLabel' },
          },
          { id: 'total', header: 'Total', value: { type: 'path', path: 'total' }, format: 'currency' },
        ],
      },
    ],
  },
} as TemplateAst;

const renderLine = async (currencyCode: string, item: Record<string, unknown>) => {
  const evaluation = evaluateTemplateAst(ast, { currencyCode, items: [item] } as never);
  const rendered = await renderEvaluatedTemplateAst(ast, evaluation);
  return rendered.html.replace(/\u00a0/g, ' ');
};

describe('standard invoice rendering: currency exponent and blank service periods', () => {
  it('scales the amount by the currency exponent, not a hardcoded 100', async () => {
    const period = { servicePeriodLabel: 'Sep 1, 2026 - Sep 30, 2026', total: 15000 };

    expect(await renderLine('USD', period)).toContain('$150.00');
    // JPY has no minor unit: 15000 is ¥15,000, not ¥150.
    expect(await renderLine('JPY', period)).toContain('¥15,000');
    // KWD has three: 15000 is 15.000 dinars.
    expect(await renderLine('KWD', period)).toContain('15.000');
  });

  it('renders the service period of a one-time line as an empty cell', async () => {
    const html = await renderLine('JPY', { servicePeriodLabel: null, total: 15000 });

    expect(html).not.toMatch(/Invalid Date|NaN|undefined/);
    expect(html).toContain('¥15,000');
  });
});
