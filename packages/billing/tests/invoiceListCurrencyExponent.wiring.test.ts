import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import { TEMPLATE_AST_VERSION, type TemplateAst } from '@alga-psa/types';

import { evaluateTemplateAst } from '../src/lib/invoice-template-ast/evaluator';
import { renderEvaluatedTemplateAst } from '../src/lib/invoice-template-ast/react-renderer';

/**
 * The invoice lists and the rendered invoice (preview and PDF) format the same
 * stored total independently, so a hardcoded /100 in a list column made one
 * invoice read two different amounts: a JPY total of 200 showed as ¥2.00 in the
 * list and ¥200 on the document. Guard the two formatters agreeing, and the
 * list call sites staying on the minor-unit formatter.
 */
const totalsAst = {
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
          { id: 'total', header: 'Total', value: { type: 'path', path: 'total' }, format: 'currency' },
        ],
      },
    ],
  },
} as TemplateAst;

const stripNbsp = (value: string) => value.replace(/ /g, ' ');

const renderTotal = async (currencyCode: string, total: number) => {
  const evaluation = evaluateTemplateAst(totalsAst, { currencyCode, items: [{ total }] } as never);
  const rendered = await renderEvaluatedTemplateAst(totalsAst, evaluation);
  return stripNbsp(rendered.html);
};

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const draftsTabSource = source('../src/components/billing-dashboard/invoicing/DraftsTab.tsx');
const finalizedTabSource = source('../src/components/billing-dashboard/invoicing/FinalizedTab.tsx');
const manualInvoicesSource = source('../src/components/billing-dashboard/ManualInvoices.tsx');
const lineItemSource = source('../src/components/billing-dashboard/LineItem.tsx');

describe('invoice list amounts honour the currency exponent', () => {
  // INV001001 in the review slot is JPY 200: the list used to read ¥2.00.
  it.each([
    ['USD', 7500],
    ['JPY', 200],
    ['KWD', 15000],
  ] as const)('formats a %s list total exactly as the rendered invoice does', async (currency, minorUnits) => {
    const listAmount = stripNbsp(formatCurrencyFromMinorUnits(minorUnits, 'en-US', currency));

    expect(await renderTotal(currency, minorUnits)).toContain(listAmount);
  });

  it('keeps the draft and finalized amount columns on the minor-unit formatter', () => {
    expect(draftsTabSource).toContain(
      "formatCurrencyFromMinorUnits(Number(value), locale, record.currencyCode || 'USD')"
    );
    expect(finalizedTabSource).toContain(
      "formatCurrencyFromMinorUnits(Number(value), locale, record.currencyCode || 'USD')"
    );
  });

  it('keeps the manual invoice amounts on the minor-unit formatter', () => {
    expect(manualInvoicesSource).toContain('formatCurrencyFromMinorUnits(item.total, locale, currencyCode)');
    // The grand total sits directly under the generated line items: it has to be
    // scaled the same way, or the screen disagrees with itself.
    expect(manualInvoicesSource).toContain(
      'formatCurrencyFromMinorUnits(calculatedGrandTotal, locale, currencyCode)'
    );
  });

  it('keeps the manual line editor on the currency exponent both ways', () => {
    // The editor writes the rate the invoice is billed from, so a fixed multiplier here
    // is the same bug as a fixed divisor in a list: ¥50 typed, ¥5,000 billed.
    expect(lineItemSource).toContain('toMinorUnits(major, undefined, currencyCode)');
    expect(lineItemSource).toContain('fromMinorUnits(minor, undefined, currencyCode)');
  });

  it('leaves no hardcoded minor-unit scaling in the invoice lists, manual invoice screen or line editor', () => {
    for (const [name, text] of [
      ['DraftsTab.tsx', draftsTabSource],
      ['FinalizedTab.tsx', finalizedTabSource],
      ['ManualInvoices.tsx', manualInvoicesSource],
      ['LineItem.tsx', lineItemSource],
    ] as const) {
      expect(`${name}: ${text.match(/[*/] ?100\b/g)?.length ?? 0}`).toBe(`${name}: 0`);
    }
  });
});
