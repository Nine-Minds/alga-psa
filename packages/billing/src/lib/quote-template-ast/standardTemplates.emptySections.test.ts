import { describe, expect, it, vi } from 'vitest';
import type { IQuote, IQuoteItem, TemplateAst } from '@alga-psa/types';

vi.mock('../adapters/tenantPartyAdapter', () => ({
  fetchTenantParty: async () => ({ name: 'Northwind MSP', address: null, email: null, phone: null, logo_url: null }),
}));

import { mapLoadedQuoteToViewModel } from '../adapters/quoteAdapters';
import { evaluateTemplateAst } from '../invoice-template-ast/evaluator';
import { renderEvaluatedTemplateAst } from '../invoice-template-ast/react-renderer';
import { STANDARD_QUOTE_TEMPLATE_ASTS } from './standardTemplates';
import legacyGroupedAst from './__fixtures__/legacy-grouped-quote-ast.json';

/**
 * Regression: alga-2026-0002383 — a one-line quote with no terms and no notes
 * ended page 1 with an empty "Terms & Conditions" heading and stranded the
 * signature block on page 2. Every stock layout, and the tenant clones frozen
 * from them, must omit a section that has nothing to head and must keep the
 * heading when there is something to head.
 */
const fakeKnex = { schema: { hasTable: vi.fn() } } as any;

const simpleQuote = (overrides: Partial<IQuote> = {}): IQuote => ({
  tenant: 'tenant-1',
  quote_id: 'quote-simple',
  quote_number: 'QT-SIMPLE',
  title: 'Simple quote',
  version: 1,
  subtotal: 50000,
  discount_total: 0,
  tax: 0,
  total_amount: 50000,
  currency_code: 'USD',
  is_template: false,
  client_id: null,
  contact_id: null,
  accepted_by: null,
  terms_and_conditions: null,
  terms_and_conditions_block: null,
  client_notes: null,
  quote_items: [
    {
      tenant: 'tenant-1',
      quote_id: 'quote-simple',
      quote_item_id: 'onetime-req',
      description: 'Onboarding',
      quantity: 1,
      unit_price: 50000,
      total_price: 50000,
      tax_amount: 0,
      net_amount: 50000,
      display_order: 1,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
      billing_frequency: null,
    } as IQuoteItem,
  ],
  ...overrides,
});

const layouts: Array<[string, TemplateAst]> = [
  ...Object.entries(STANDARD_QUOTE_TEMPLATE_ASTS),
  ['frozen legacy grouped clone', legacyGroupedAst as unknown as TemplateAst],
];

const render = async (ast: TemplateAst, quote: IQuote) => {
  const viewModel = await mapLoadedQuoteToViewModel(fakeKnex, 'tenant-1', quote);
  const evaluation = evaluateTemplateAst(ast, viewModel as unknown as Record<string, unknown>);
  return renderEvaluatedTemplateAst(ast, evaluation, { locale: 'en-US' });
};

describe.each(layouts)('%s: empty terms and notes', (_name, ast) => {
  it('omits the Terms & Conditions heading and still prints the signature block', async () => {
    const { html } = await render(ast, simpleQuote());
    expect(html).toContain('Onboarding');
    expect(html).not.toContain('Terms &amp; Conditions');
    expect(html).not.toContain('id="terms-section"');
    expect(html).toContain('id="signature-block"');
    expect(html).toContain('Accepted By');
    expect(html).toContain('Authorized By');
  });

  it('prints the heading when there are terms to head', async () => {
    const { html } = await render(
      ast,
      simpleQuote({
        terms_and_conditions: 'Net 30. Prices valid for 30 days.',
        terms_and_conditions_block: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Net 30. Prices valid for 30 days.' }] },
        ] as any,
        client_notes: 'Install scheduled for the first week of the month.',
      }),
    );
    expect(html).toContain('Terms &amp; Conditions');
    expect(html).toContain('Net 30. Prices valid for 30 days.');
    expect(html).toContain('Install scheduled for the first week of the month.');
    expect(html).toContain('id="signature-block"');
  });

  it('treats a terms editor left with one empty paragraph as no terms', async () => {
    const { html } = await render(
      ast,
      simpleQuote({
        terms_and_conditions: '',
        terms_and_conditions_block: [{ type: 'paragraph', content: [] }] as any,
      }),
    );
    expect(html).not.toContain('Terms &amp; Conditions');
  });
});

describe('standard-quote-default: the titled Notes section', () => {
  // Only the default layout heads client notes with a section title; the
  // grouped and by-location layouts box them in a card beside the totals and
  // the detailed layout prints them inline, so they have no heading to orphan.
  const ast = STANDARD_QUOTE_TEMPLATE_ASTS['standard-quote-default'];

  it('is omitted when there are no notes', async () => {
    const { html } = await render(ast, simpleQuote());
    expect(html).not.toContain('id="client-notes-section"');
    expect(html).not.toContain('>Notes<');
  });

  it('is printed when there are notes', async () => {
    const { html } = await render(ast, simpleQuote({ client_notes: 'Install in the first week.' }));
    expect(html).toContain('id="client-notes-section"');
    expect(html).toContain('<h2>Notes</h2>');
    expect(html).toContain('Install in the first week.');
  });
});
