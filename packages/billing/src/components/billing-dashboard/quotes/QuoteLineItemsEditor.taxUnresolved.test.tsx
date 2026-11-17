// @vitest-environment jsdom

/**
 * T010: a taxable, included line whose region has no tax rate is marked with the
 * region's NAME, and the totals note appears under the tax total.
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string> & { defaultValue?: string }) =>
      (opts?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, k) => opts?.[k] ?? ''),
  }),
  useFormatters: () => ({ formatCurrency: (n: number) => `$${n}` }),
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [],
  useFormatBillingFrequency: () => (value: string) => value,
}));
vi.mock('@alga-psa/billing/actions/unitOfMeasureActions', () => ({
  listTenantUnitsOfMeasure: vi.fn(async () => []),
  registerTenantUnitOfMeasure: vi.fn(),
}));
vi.mock('../contracts/ServiceCatalogPicker', () => ({ default: () => null }));
vi.mock('../locations/LocationPicker', () => ({ default: () => null }));
vi.mock('../locations/LocationAddress', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/UnitOfMeasureInput', () => ({ UnitOfMeasureInput: () => null }));

import QuoteLineItemsEditor from './QuoteLineItemsEditor';
import { QuoteTaxUnresolvedNote } from './QuoteTaxUnresolvedNote';
import type { DraftQuoteItem } from './quoteLineItemDraft';

const line = (overrides: Partial<DraftQuoteItem> = {}): DraftQuoteItem => ({
  local_id: 'line-1',
  quote_item_id: '11111111-1111-1111-1111-111111111111',
  description: 'Managed service',
  quantity: 1,
  unit_price: 10000,
  is_optional: false,
  is_selected: true,
  is_recurring: false,
  is_taxable: true,
  tax_region: 'US-NY',
  tax_unresolved: true,
  ...overrides,
} as DraftQuoteItem);

afterEach(cleanup);

const renderEditor = (items: DraftQuoteItem[]) =>
  render(
    <QuoteLineItemsEditor
      items={items}
      currencyCode="USD"
      onChange={() => undefined}
      taxRegionNames={{ 'US-NY': 'New York State' }}
    />,
  );

describe('QuoteLineItemsEditor unresolved tax', () => {
  it('marks an unresolved included line with the region name, never its id', () => {
    renderEditor([line()]);
    const badge = document.getElementById('quote-line-tax-unresolved-line-1');
    expect(badge?.textContent).toBe('No tax rate for New York State');
    expect(document.body.textContent).not.toContain('11111111-1111');
  });

  it.each([
    ['a resolved line', { tax_unresolved: false }],
    ['a non-taxable line', { is_taxable: false }],
    ['an unselected optional line', { is_optional: true, is_selected: false }],
  ])('shows no badge for %s', (_label, overrides) => {
    renderEditor([line(overrides as Partial<DraftQuoteItem>)]);
    expect(document.getElementById('quote-line-tax-unresolved-line-1')).toBeNull();
  });
});

describe('QuoteTaxUnresolvedNote', () => {
  it('shows the note when any included line is unresolved', () => {
    render(<QuoteTaxUnresolvedNote items={[line({ tax_unresolved: false, local_id: 'a' }), line()]} />);
    expect(screen.getByText('Tax could not be calculated for some lines. Those lines show 0 tax.')).toBeTruthy();
  });

  it('shows nothing when every included line is resolved or only an unselected optional line is unresolved', () => {
    const { container } = render(
      <QuoteTaxUnresolvedNote items={[line({ tax_unresolved: false }), line({ local_id: 'b', is_optional: true, is_selected: false })]} />,
    );
    expect(container.textContent).toBe('');
  });
});
