// @vitest-environment jsdom

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';
import type { TemplateAst } from '@alga-psa/types';
import { evaluateTemplateAst } from './evaluator';
import { TemplateAstRenderer } from './react-renderer';

afterEach(() => cleanup());

const buildTwoRowTotalsAst = (): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: { currencyCode: 'USD', locale: 'en-US' },
  bindings: { values: {}, collections: {} },
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems' },
        rows: [
          {
            id: 'monthly-total',
            label: 'Monthly Total',
            value: { type: 'literal', value: 330 },
            format: 'currency',
            emphasize: true,
            style: { inline: { backgroundColor: '#0f766e', color: '#f8fafc', padding: '4px 6px' } },
            labelStyle: { inline: { color: '#facc15' } },
          },
          {
            id: 'onetime-total',
            label: 'One-time Total',
            value: { type: 'literal', value: 950 },
            format: 'currency',
            style: { inline: { backgroundColor: '#7c45d3', color: '#ffffff' } },
          },
        ],
      },
    ],
  },
});

describe('totals-row branding rendering (T006)', () => {
  it('renders each totals row with its own background/text color and keeps labelStyle label-only', () => {
    const ast = buildTwoRowTotalsAst();
    const evaluation = evaluateTemplateAst(ast, { currencyCode: 'USD', items: [] });
    const { container } = render(<TemplateAstRenderer ast={ast} evaluation={evaluation} />);

    const rows = container.querySelectorAll('.ast-totals-row');
    expect(rows.length).toBe(2);

    const monthlyRow = rows[0] as HTMLElement;
    const onetimeRow = rows[1] as HTMLElement;
    expect(monthlyRow.style.backgroundColor).toBe('rgb(15, 118, 110)');
    expect(monthlyRow.style.color).toBe('rgb(248, 250, 252)');
    expect(onetimeRow.style.backgroundColor).toBe('rgb(124, 69, 211)');
    expect(onetimeRow.style.color).toBe('rgb(255, 255, 255)');

    // Distinct row colors, not a shared parent recolor.
    expect(monthlyRow.style.backgroundColor).not.toBe(onetimeRow.style.backgroundColor);

    // Label override is label-only on the monthly row.
    const monthlyLabel = monthlyRow.querySelector('.ast-totals-label') as HTMLElement;
    const monthlyValue = monthlyRow.querySelector('.ast-totals-value') as HTMLElement;
    expect(monthlyLabel.style.color).toBe('rgb(250, 204, 21)');
    expect(monthlyValue.getAttribute('style')).toBeNull();

    // The one-time label carries no override and inherits the row text color.
    const onetimeLabel = onetimeRow.querySelector('.ast-totals-label') as HTMLElement;
    expect(onetimeLabel.getAttribute('style')).toBeNull();
    expect(onetimeLabel.textContent).toBe('One-time Total');
    expect(monthlyLabel.textContent).toBe('Monthly Total');
  });

  it('renders rows without explicit styles with no color declarations at all', () => {
    const ast = buildTwoRowTotalsAst();
    ast.layout = {
      id: 'root',
      type: 'document',
      children: [
        {
          id: 'totals',
          type: 'totals',
          sourceBinding: { bindingId: 'lineItems' },
          rows: [
            { id: 'subtotal', label: 'Subtotal', value: { type: 'literal', value: 120 } },
            { id: 'total', label: 'Total', value: { type: 'literal', value: 120 }, emphasize: true },
          ],
        },
      ],
    };
    const evaluation = evaluateTemplateAst(ast, { currencyCode: 'USD', items: [] });
    const { container } = render(<TemplateAstRenderer ast={ast} evaluation={evaluation} />);

    const rows = container.querySelectorAll('.ast-totals-row');
    expect(rows.length).toBe(2);
    for (const row of Array.from(rows)) {
      const style = (row as HTMLElement).getAttribute('style') ?? '';
      expect(style).not.toContain('color:');
      expect(style).not.toContain('background');
    }
  });
});
