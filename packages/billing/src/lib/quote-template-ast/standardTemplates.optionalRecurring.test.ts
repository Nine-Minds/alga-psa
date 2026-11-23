import { describe, expect, it, vi } from 'vitest';
import type { IQuote, IQuoteItem, TemplateAst } from '@alga-psa/types';

vi.mock('../adapters/tenantPartyAdapter', () => ({
  fetchTenantParty: async () => ({ name: 'Northwind MSP', address: null, email: null, phone: null, logo_url: null }),
}));

import { mapLoadedQuoteToViewModel } from '../adapters/quoteAdapters';
import { evaluateTemplateAst } from '../invoice-template-ast/evaluator';
import { renderEvaluatedTemplateAst } from '../invoice-template-ast/react-renderer';
import { getStandardQuoteTemplateAstByCode } from './standardTemplates';

const fakeKnex = { schema: { hasTable: vi.fn() } } as any;

const row = (overrides: Partial<IQuoteItem>): IQuoteItem =>
  ({
    tenant: 'tenant-1',
    quote_id: 'quote-1',
    description: 'Item',
    quantity: 1,
    unit_price: 1000,
    total_price: 1000,
    tax_amount: 0,
    net_amount: 1000,
    display_order: 1,
    is_optional: false,
    is_selected: true,
    is_recurring: false,
    billing_frequency: null,
    ...overrides,
  }) as IQuoteItem;

const quote = (items: IQuoteItem[]): IQuote =>
  ({
    tenant: 'tenant-1',
    quote_id: 'quote-1',
    quote_number: 'Q-0001',
    title: 'Managed services',
    version: 1,
    subtotal: 3000,
    discount_total: 0,
    tax: 0,
    total_amount: 3000,
    currency_code: 'USD',
    is_template: false,
    client_id: null,
    contact_id: null,
    accepted_by: null,
    quote_items: items,
  }) as IQuote;

const renderDetailed = async (items: IQuoteItem[], t?: (key: string, o: { defaultValue: string }) => string) => {
  const ast = getStandardQuoteTemplateAstByCode('standard-quote-detailed') as TemplateAst;
  const viewModel = await mapLoadedQuoteToViewModel(fakeKnex, 'tenant-1', quote(items));
  const evaluation = evaluateTemplateAst(ast, viewModel as unknown as Record<string, unknown>);
  return (await renderEvaluatedTemplateAst(ast, evaluation, { locale: 'en-US', t })).html;
};

describe('standard detailed quote: Optional and Recurring columns', () => {
  const items = [
    row({ quote_item_id: 'rec', description: 'Managed Support', is_recurring: true, billing_frequency: 'monthly', display_order: 1 }),
    row({ quote_item_id: 'opt', description: 'Endpoint Backup', is_optional: true, is_selected: true, display_order: 2 }),
    row({ quote_item_id: 'plain', description: 'Onboarding', display_order: 3 }),
  ];

  it('never prints the literal true or false', async () => {
    const html = await renderDetailed(items);
    expect(html).not.toMatch(/>\s*(true|false)\s*</);
    expect(html).not.toMatch(/\b(true|false)\b/);
  });

  it('prints Yes/No for Recurring and the localized marker for Optional', async () => {
    const html = await renderDetailed(items);
    expect(html).toContain('>Yes<');
    expect(html).toContain('>No<');
    expect(html).toContain('Optional (included)');
  });

  it('localizes the Recurring Yes/No', async () => {
    const t = (key: string, { defaultValue }: { defaultValue: string }) =>
      ({ 'labels.yes': 'Ja', 'labels.no': 'Nein' } as Record<string, string>)[key] ?? defaultValue;
    const html = await renderDetailed(items, t);
    expect(html).toContain('>Ja<');
    expect(html).toContain('>Nein<');
  });
});
