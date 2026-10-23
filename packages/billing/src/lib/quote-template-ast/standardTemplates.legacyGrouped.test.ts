import { describe, expect, it, vi } from 'vitest';
import type { IQuote, IQuoteItem, TemplateAst } from '@alga-psa/types';

vi.mock('../adapters/tenantPartyAdapter', () => ({
  fetchTenantParty: async () => ({ name: 'Northwind MSP', address: null, email: null, phone: null, logo_url: null }),
}));

import { mapLoadedQuoteToViewModel } from '../adapters/quoteAdapters';
import { evaluateTemplateAst } from '../invoice-template-ast/evaluator';
import { renderEvaluatedTemplateAst } from '../invoice-template-ast/react-renderer';
import { validateTemplateAst } from '../invoice-template-ast/schema';
import legacyGroupedAst from './__fixtures__/legacy-grouped-quote-ast.json';

/**
 * A tenant that customized the grouped quote layout before alga-2026-0002383
 * keeps its frozen clone of the *pre-cadence* AST (`__fixtures__` is the
 * grouped AST as shipped on main before this change). That clone must keep
 * rendering from today's view model with its legacy `recurring_*` /
 * `onetime_*` bindings, and its "Monthly Total" must equal the same
 * inclusion rule every other surface uses. Adopting cadence bands requires
 * re-cloning from the standard grouped template; there is no back-migration.
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

const quote: IQuote = {
  tenant: 'tenant-1',
  quote_id: 'quote-1',
  quote_number: 'QT-LEGACY',
  title: 'Legacy grouped clone',
  version: 1,
  subtotal: 79900,
  discount_total: 0,
  tax: 4794,
  total_amount: 84694,
  currency_code: 'USD',
  is_template: false,
  client_id: null,
  contact_id: null,
  accepted_by: null,
  quote_items: [
    row({ quote_item_id: 'monthly-req', description: 'Managed Support', unit_price: 10000, total_price: 10000, tax_amount: 600, tax_rate: 6, is_recurring: true, billing_frequency: 'monthly', display_order: 1 }),
    row({ quote_item_id: 'annual-req', description: 'Annual Firewall Subscription', unit_price: 15900, total_price: 15900, tax_amount: 954, tax_rate: 6, is_recurring: true, billing_frequency: 'annually', display_order: 2 }),
    row({ quote_item_id: 'onetime-req', description: 'Onboarding', unit_price: 50000, total_price: 50000, tax_amount: 3000, tax_rate: 6, display_order: 3 }),
    row({ quote_item_id: 'monthly-opt', description: 'Optional Endpoint Backup', unit_price: 4000, total_price: 4000, tax_amount: 240, tax_rate: 6, is_recurring: true, billing_frequency: 'monthly', is_optional: true, is_selected: true, display_order: 4 }),
    row({ quote_item_id: 'annual-opt', description: 'Optional Annual Security Review', unit_price: 5000, total_price: 5000, tax_amount: 0, tax_rate: 6, is_recurring: true, billing_frequency: 'annually', is_optional: true, is_selected: false, display_order: 5 }),
  ],
};

describe('frozen legacy grouped clone (pre-cadence AST) against the current view model', () => {
  const ast = legacyGroupedAst as unknown as TemplateAst;

  it('is still a valid template AST', () => {
    expect(() => validateTemplateAst(ast)).not.toThrow();
    expect(JSON.stringify(ast)).toContain('recurringTotal');
  });

  it('renders with legacy bindings and the shared inclusion rule for its totals', async () => {
    const viewModel = await mapLoadedQuoteToViewModel(fakeKnex, 'tenant-1', quote);
    const evaluation = evaluateTemplateAst(ast, viewModel as unknown as Record<string, unknown>);
    const { html } = await renderEvaluatedTemplateAst(ast, evaluation, { locale: 'en-US' });

    // Legacy layout: one "Monthly Items" table over every recurring row (the
    // annual line included — the reason the cadence layout exists) and a
    // "Monthly Total" from the legacy recurring_* bindings.
    expect(html).toContain('Monthly Items');
    expect(html).toContain('Annual Firewall Subscription');
    expect(html).toContain('Monthly Total');

    // recurring_* count included rows only: $100 + $159 + $40 selected add-on,
    // never the pending $50 — the same rule as the persisted total.
    expect(viewModel.recurring_subtotal).toBe(29900);
    expect(viewModel.recurring_tax).toBe(1794);
    expect(viewModel.recurring_total).toBe(31694);
    expect(html).toContain('$316.94');
    expect(viewModel.onetime_total).toBe(53000);
    expect(html).toContain('$530.00');

    // The legacy layout prints no grand total; its two group totals add up to
    // the persisted total exactly (no pending add-on leaks in).
    expect((viewModel.recurring_total ?? 0) + (viewModel.onetime_total ?? 0)).toBe(quote.total_amount);
    expect(viewModel.total_amount).toBe(quote.total_amount);
    expect(html).not.toContain('$50.00</span>'); // pending row is listed in the table only, never totalled
  });
});
