import { describe, expect, it, vi } from 'vitest';
import type { IQuote, IQuoteItem, TemplateAst } from '@alga-psa/types';

vi.mock('../adapters/tenantPartyAdapter', () => ({
  fetchTenantParty: async () => ({ name: 'Northwind MSP', address: null, email: null, phone: null, logo_url: null }),
}));

import { mapLoadedQuoteToViewModel } from '../adapters/quoteAdapters';
import { evaluateTemplateAst } from '../invoice-template-ast/evaluator';
import { renderEvaluatedTemplateAst } from '../invoice-template-ast/react-renderer';
import { getStandardQuoteTemplateAstByCode } from './standardTemplates';
import legacyGroupedAst from './__fixtures__/legacy-grouped-quote-ast.json';

/**
 * alga-2026-0002573 end to end: a quote's own section titles must reach the
 * rendered document, not just the view model.
 *
 * The grouped layout names each band from `groups_by_cadence[].name`, so this
 * walks the whole seam the preview and the PDF share — adapter, evaluator,
 * renderer — and asserts the printed heading. It also pins the deliberate
 * back-compat gap: a tenant's frozen pre-cadence clone has fixed headings and
 * silently keeps them, rather than erroring or printing "[object Object]".
 */
const fakeKnex = { schema: { hasTable: vi.fn() } } as any;

const row = (overrides: Partial<IQuoteItem>): IQuoteItem => ({
  tenant: 'tenant-1',
  quote_id: 'quote-1',
  description: 'Item',
  quantity: 1,
  unit_price: 0,
  total_price: 0,
  tax_amount: 0,
  net_amount: 0,
  display_order: 1,
  is_optional: false,
  is_selected: true,
  is_recurring: false,
  billing_frequency: null,
  ...overrides,
} as IQuoteItem);

const quote = (overrides: Partial<IQuote> = {}): IQuote => ({
  tenant: 'tenant-1',
  quote_id: 'quote-1',
  quote_number: 'Q-0001',
  title: 'Emerald City managed services',
  version: 1,
  subtotal: 509000,
  discount_total: 0,
  tax: 40720,
  total_amount: 549720,
  currency_code: 'USD',
  is_template: false,
  client_id: null,
  contact_id: null,
  accepted_by: null,
  quote_items: [
    row({ quote_item_id: 'monthly-req', description: 'Managed Support', unit_price: 100000, total_price: 100000, tax_amount: 8000, is_recurring: true, billing_frequency: 'monthly', display_order: 1 }),
    row({ quote_item_id: 'annual-req', description: 'Annual Firewall Subscription', unit_price: 159000, total_price: 159000, tax_amount: 12720, is_recurring: true, billing_frequency: 'annually', display_order: 2 }),
    row({ quote_item_id: 'onetime-req', description: 'Onboarding & Kickoff', unit_price: 250000, total_price: 250000, tax_amount: 20000, display_order: 3 }),
  ],
  ...overrides,
});

const renderWith = async (ast: TemplateAst, source: IQuote): Promise<string> => {
  const viewModel = await mapLoadedQuoteToViewModel(fakeKnex, 'tenant-1', source);
  const evaluation = evaluateTemplateAst(ast, viewModel as unknown as Record<string, unknown>);
  const { html } = await renderEvaluatedTemplateAst(ast, evaluation, { locale: 'en-US' });
  return html;
};

describe('grouped quote section titles reach the rendered document', () => {
  const groupedAst = () => getStandardQuoteTemplateAstByCode('standard-quote-grouped') as TemplateAst;

  it('prints the custom monthly and one-time headings and leaves other cadences alone', async () => {
    const html = await renderWith(groupedAst(), quote({
      recurring_section_title: 'Ongoing Care Plan',
      onetime_section_title: 'Kickoff & Setup',
    }));

    expect(html).toContain('Ongoing Care Plan');
    expect(html).toContain('Kickoff &amp; Setup');
    expect(html).toContain('Ongoing Care Plan Total');
    // The annual band was never renamed, so it keeps the cadence vocabulary.
    expect(html).toContain('Annually');
    expect(html).not.toContain('[object Object]');
  });

  it('falls back to the cadence band names when the titles are blank or spaces', async () => {
    const html = await renderWith(groupedAst(), quote({
      recurring_section_title: '   ',
      onetime_section_title: null,
    }));

    expect(html).toContain('Monthly Total');
    expect(html).toContain('One-time Total');
    expect(html).not.toContain('[object Object]');
  });

  it('keeps a frozen pre-cadence tenant clone on its fixed headings', async () => {
    const html = await renderWith(legacyGroupedAst as unknown as TemplateAst, quote({
      recurring_section_title: 'Ongoing Care Plan',
      onetime_section_title: 'Kickoff & Setup',
    }));

    expect(html).toContain('Monthly Items');
    expect(html).toContain('One-time Items');
    expect(html).not.toContain('Ongoing Care Plan');
    expect(html).not.toContain('[object Object]');
  });
});
