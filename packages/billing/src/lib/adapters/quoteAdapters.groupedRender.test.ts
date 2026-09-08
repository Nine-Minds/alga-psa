import { describe, expect, it, vi } from 'vitest';
import type { IQuote } from '@alga-psa/types';

const fetchTenantPartyMock = vi.fn().mockResolvedValue({
  name: 'Northwind MSP',
  address: '400 SW Main',
  email: 'billing@example.com',
  phone: '555-0100',
  logo_url: null,
});

vi.mock('./tenantPartyAdapter', () => ({
  fetchTenantParty: (...args: unknown[]) => fetchTenantPartyMock(...args),
}));

import { mapLoadedQuoteToViewModel } from './quoteAdapters';
import { evaluateTemplateAst } from '../invoice-template-ast/evaluator';
import { renderEvaluatedTemplateAst } from '../invoice-template-ast/react-renderer';
import { getStandardQuoteTemplateAstByCode } from '../quote-template-ast/standardTemplates';

const fakeKnex = { schema: { hasTable: vi.fn() } } as any;

const quote: IQuote = {
  tenant: 'tenant-1',
  quote_id: 'quote-1',
  quote_number: 'QUO-0001',
  title: 'Managed Services',
  version: 1,
  subtotal: 26000,
  discount_total: 1000,
  tax: 0,
  total_amount: 25000,
  currency_code: 'USD',
  is_template: false,
  client_id: null,
  contact_id: null,
  accepted_by: null,
  quote_items: [
    {
      tenant: 'tenant-1', quote_id: 'quote-1', quote_item_id: 'monthly-1', service_id: 'svc-1',
      service_name: 'Managed Workstation', description: 'Monitoring, patching and helpdesk per workstation.',
      quantity: 1, unit_price: 3000, total_price: 3000, tax_amount: 0, net_amount: 3000,
      display_order: 1, is_optional: false, is_selected: true, is_recurring: true,
      billing_frequency: 'monthly', service_item_kind: 'service',
    },
    {
      tenant: 'tenant-1', quote_id: 'quote-1', quote_item_id: 'monthly-2', service_id: 'svc-2',
      service_name: 'Managed Server', description: 'Server monitoring and maintenance.',
      quantity: 1, unit_price: 3000, total_price: 3000, tax_amount: 0, net_amount: 3000,
      display_order: 2, is_optional: false, is_selected: true, is_recurring: true,
      billing_frequency: 'monthly', service_item_kind: 'service',
    },
    {
      tenant: 'tenant-1', quote_id: 'quote-1', quote_item_id: 'discount-1', description: 'Discount',
      quantity: 1, unit_price: 500, total_price: 500, tax_amount: 0, net_amount: 500,
      display_order: 3, is_optional: false, is_selected: true, is_recurring: false,
      is_discount: true, discount_type: 'fixed', applies_to_item_id: 'monthly-1',
    },
    {
      tenant: 'tenant-1', quote_id: 'quote-1', quote_item_id: 'discount-2', description: 'Discount',
      quantity: 1, unit_price: 500, total_price: 500, tax_amount: 0, net_amount: 500,
      display_order: 4, is_optional: false, is_selected: true, is_recurring: false,
      is_discount: true, discount_type: 'fixed', applies_to_item_id: 'monthly-2',
    },
    {
      tenant: 'tenant-1', quote_id: 'quote-1', quote_item_id: 'onetime-1', service_id: 'svc-3',
      service_name: 'Onboarding Project', description: 'One-time onboarding and documentation.',
      quantity: 1, unit_price: 20000, total_price: 20000, tax_amount: 0, net_amount: 20000,
      display_order: 5, is_optional: false, is_selected: true, is_recurring: false,
      service_item_kind: 'service',
    },
  ],
};

// alga-2026-0002353 / alga-2026-0002354 — end-to-end shape of the reported
// quote: two monthly services, a $5 discount on each, and a one-time project.
describe('grouped quote template render', () => {
  it('renders Monthly Total net of discounts with the one-time group untouched', async () => {
    const viewModel = await mapLoadedQuoteToViewModel(fakeKnex, 'tenant-1', quote);
    const ast = getStandardQuoteTemplateAstByCode('standard-quote-grouped')!;
    const evaluation = evaluateTemplateAst(ast, viewModel as unknown as Record<string, unknown>);
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);

    expect(viewModel.recurring_total).toBe(5000);
    expect(viewModel.onetime_total).toBe(20000);

    // Monthly Total $50.00 ($30 + $30 − $5 − $5); one-time stays $200.00.
    expect(rendered.html).toContain('<span class="ast-totals-value">$50.00</span>');
    expect(rendered.html).toContain('<span class="ast-totals-value">$200.00</span>');
    // Discount rows print under Monthly Items as deductions.
    expect(rendered.html).toContain('-$5.00');
    // Description cells stack the catalog item name over its description.
    expect(rendered.html).toContain('Managed Workstation\nMonitoring, patching and helpdesk per workstation.');
  });
});
