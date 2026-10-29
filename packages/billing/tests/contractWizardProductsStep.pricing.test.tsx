// @vitest-environment jsdom
//
// The Products step derives every price from the wizard draft (and the shared
// catalog lookup for resumed drafts) - never from index-keyed local state, which
// was lost when the step unmounted and shifted when a row was removed.

import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getServiceCatalogRatesForCurrency: vi.fn(),
  getServiceCatalogCostInfo: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServiceCatalogRatesForCurrency: actionMocks.getServiceCatalogRatesForCurrency,
  getServiceCatalogCostInfo: actionMocks.getServiceCatalogCostInfo,
}));

const translate = (key: string, options?: Record<string, unknown>) => {
  let value = String(options?.defaultValue ?? key);
  for (const [name, replacement] of Object.entries(options ?? {})) {
    if (name === 'defaultValue') continue;
    value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({
    money: (cents: number, currency = 'AUD') => `${currency} ${(cents / 100).toFixed(2)}`,
  }),
}));

vi.mock('@alga-psa/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/core')>()),
  getCurrencySymbol: () => '$',
}));

const PRODUCTS: Record<string, any> = {
  'svc-a': { service_id: 'svc-a', service_name: 'Product A', default_rate: 0, currency_rate: 10000 },
  'svc-b': { service_id: 'svc-b', service_name: 'Product B', default_rate: 0, currency_rate: 20000 },
  'svc-c': { service_id: 'svc-c', service_name: 'Product C', default_rate: 0, currency_rate: 30000 },
};

// One button per product so a test can "pick" it in a given row.
vi.mock('../src/components/billing-dashboard/contracts/ServiceCatalogPicker', () => ({
  ServiceCatalogPicker: ({ id, selectedLabel, onSelect }: any) => (
    <div data-testid={id}>
      <span>{selectedLabel}</span>
      {Object.values(PRODUCTS).map((item: any) => (
        <button key={item.service_id} type="button" onClick={() => onSelect(item)}>
          {`pick ${id} ${item.service_id}`}
        </button>
      ))}
    </div>
  ),
}));

import { ProductsStep } from '../src/components/billing-dashboard/contracts/wizard-steps/ProductsStep';
import { resetProductCatalogRatesCache } from '../src/hooks/useProductCatalogRates';
import type { ContractWizardData } from '../src/components/billing-dashboard/contracts/ContractWizard';

let latestData: ContractWizardData;

function Harness({ initial, showStep = true }: { initial: ContractWizardData['product_services']; showStep?: boolean }) {
  const [data, setData] = useState({
    currency_code: 'AUD',
    product_services: initial,
  } as ContractWizardData);
  latestData = data;
  return showStep ? (
    <ProductsStep data={data} updateData={(patch) => setData((prev) => ({ ...prev, ...patch }))} />
  ) : null;
}

const NO_PRICE = /No AUD price in the catalog/;
const NO_DEFAULT = /no default price and no override/;

describe('ProductsStep pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProductCatalogRatesCache();
    actionMocks.getServiceCatalogRatesForCurrency.mockImplementation(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, PRODUCTS[id]?.currency_rate ?? null])));
    actionMocks.getServiceCatalogCostInfo.mockImplementation(async (ids: string[]) => ({
      canViewCost: true,
      items: Object.fromEntries(ids.map((id) => [id, { default_rate: 0, cost: 4000, cost_currency: 'AUD' }])),
    }));
  });

  it('still shows the catalog price after leaving the step and coming back', async () => {
    const first = render(<Harness initial={[{ service_id: '', quantity: 1 }]} />);
    fireEvent.click(screen.getByText('pick product-select-0 svc-a'));
    expect(screen.getByTestId('product-catalog-price-0').textContent).toBe('Catalog price in AUD: AUD 100.00');

    // The wizard unmounts the step on navigation and remounts it with the draft it holds.
    const draft = latestData.product_services;
    first.unmount();
    render(<Harness initial={draft} />);

    expect(screen.getByTestId('product-catalog-price-0').textContent).toBe('Catalog price in AUD: AUD 100.00');
    expect(screen.queryByText(NO_PRICE)).toBeNull();
    expect(screen.queryByText(NO_DEFAULT)).toBeNull();
  });

  it('keeps each remaining row on its own price when the first of three products is removed', async () => {
    render(<Harness initial={[
      { service_id: 'svc-a', service_name: 'Product A', quantity: 1, currency_rate: 10000, default_rate: 0 },
      { service_id: 'svc-b', service_name: 'Product B', quantity: 1, currency_rate: 20000, default_rate: 0 },
      { service_id: 'svc-c', service_name: 'Product C', quantity: 1, currency_rate: 30000, default_rate: 0 },
    ]} />);

    fireEvent.click(document.getElementById('remove-product-0')!);

    expect(screen.queryByText('Product A')).toBeNull();
    expect(screen.getByTestId('product-catalog-price-0').textContent).toBe('Catalog price in AUD: AUD 200.00');
    expect(screen.getByTestId('product-catalog-price-1').textContent).toBe('Catalog price in AUD: AUD 300.00');
    expect(screen.queryByText(NO_PRICE)).toBeNull();
    expect(screen.queryByText(NO_DEFAULT)).toBeNull();
  });

  it('prices a resumed draft row (no currency_rate) through the shared lookup, as Review does', async () => {
    render(<Harness initial={[{ service_id: 'svc-b', service_name: 'Product B', quantity: 1 }]} />);

    // While the lookup is in flight nothing is claimed about the price.
    expect(screen.queryByText(NO_PRICE)).toBeNull();
    expect(screen.queryByText(NO_DEFAULT)).toBeNull();

    await waitFor(() =>
      expect(screen.getByTestId('product-catalog-price-0').textContent).toBe('Catalog price in AUD: AUD 200.00'));
    expect(actionMocks.getServiceCatalogRatesForCurrency).toHaveBeenCalledWith(['svc-b'], 'AUD');
    expect(screen.queryByText(NO_DEFAULT)).toBeNull();
  });

  it('shows cost and margin in the contract currency, and labels a foreign cost currency without a margin', async () => {
    actionMocks.getServiceCatalogCostInfo.mockResolvedValue({
      canViewCost: true,
      items: {
        'svc-a': { default_rate: 0, cost: 4000, cost_currency: 'AUD' },
        'svc-b': { default_rate: 0, cost: 5000, cost_currency: 'NZD' },
      },
    });
    render(<Harness initial={[
      { service_id: 'svc-a', service_name: 'Product A', quantity: 1, currency_rate: 10000, default_rate: 0 },
      { service_id: 'svc-b', service_name: 'Product B', quantity: 1, currency_rate: 20000, default_rate: 0 },
    ]} />);

    await waitFor(() => expect(screen.getByTestId('product-cost-0')).not.toBeNull());
    expect(screen.getByTestId('product-cost-0').textContent).toBe('Cost: AUD 40.00 · Margin: AUD 60.00 per unit');
    expect(screen.getByTestId('product-cost-1').textContent).toBe('Cost in NZD: NZD 50.00');
  });

  it('does not render cost for a user without the cost-visibility permission', async () => {
    actionMocks.getServiceCatalogCostInfo.mockResolvedValue({
      canViewCost: false,
      items: { 'svc-a': { default_rate: 0, cost: null, cost_currency: null } },
    });
    render(<Harness initial={[
      { service_id: 'svc-a', service_name: 'Product A', quantity: 1, currency_rate: 10000, default_rate: 0 },
    ]} />);

    await waitFor(() => expect(actionMocks.getServiceCatalogCostInfo).toHaveBeenCalled());
    expect(screen.getByTestId('product-catalog-price-0')).not.toBeNull();
    expect(screen.queryByTestId('product-cost-0')).toBeNull();
    expect(screen.queryByText(/Cost/)).toBeNull();
  });
});
