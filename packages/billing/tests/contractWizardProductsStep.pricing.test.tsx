// @vitest-environment jsdom
//
// The Products step derives every price from the shared catalog lookup keyed by
// (contract currency, service id) - never from index-keyed local state (lost when
// the step unmounted, shifted when a row was removed) and never from a price
// copied onto the draft row (stale after a currency change).

import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  useOptionalI18n: () => null,
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

const NZD_PRICES: Record<string, number | null> = { 'svc-a': 11000, 'svc-b': null, 'svc-c': 33000 };

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

let setHarnessData: React.Dispatch<React.SetStateAction<ContractWizardData>>;

function Harness({ initial, currency = 'AUD' }: { initial: ContractWizardData['product_services']; currency?: string }) {
  const [data, setData] = useState({
    currency_code: currency,
    product_services: initial,
  } as ContractWizardData);
  latestData = data;
  setHarnessData = setData;
  return <ProductsStep data={data} updateData={(patch) => setData((prev) => ({ ...prev, ...patch }))} />;
}

const NO_PRICE = /No AUD price in the catalog/;
const NO_DEFAULT = /no default price and no override/;

describe('ProductsStep pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProductCatalogRatesCache();
    actionMocks.getServiceCatalogRatesForCurrency.mockImplementation(async (ids: string[], currency: string) =>
      Object.fromEntries(ids.map((id) => [
        id,
        currency === 'NZD' ? NZD_PRICES[id] ?? null : PRODUCTS[id]?.currency_rate ?? null,
      ])));
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

  it('keeps the draft free of catalog prices: the row holds only what the user chose', () => {
    render(<Harness initial={[{ service_id: '', quantity: 1 }]} />);
    fireEvent.click(screen.getByText('pick product-select-0 svc-a'));
    expect(latestData.product_services[0]).toEqual({
      service_id: 'svc-a',
      service_name: 'Product A',
      quantity: 1,
      custom_rate: undefined,
    });
  });

  it('re-prices every row in the new currency when the contract currency changes after picking', async () => {
    render(<Harness initial={[{ service_id: '', quantity: 1 }, { service_id: '', quantity: 1 }]} />);
    fireEvent.click(screen.getByText('pick product-select-0 svc-a'));
    fireEvent.click(screen.getByText('pick product-select-1 svc-b'));
    expect(screen.getByTestId('product-catalog-price-0').textContent).toBe('Catalog price in AUD: AUD 100.00');

    act(() => setHarnessData((prev) => ({ ...prev, currency_code: 'NZD' })));

    // Never the AUD price under an NZD label: the AUD figure is gone at once.
    expect(screen.queryByText(/AUD 100.00/)).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('product-catalog-price-0').textContent).toBe('Catalog price in NZD: NZD 110.00'));
    // svc-b has no NZD price: that is now a real missing price, not a stale AUD one.
    expect(screen.getByText(/No NZD price in the catalog/)).not.toBeNull();
    expect(actionMocks.getServiceCatalogRatesForCurrency).toHaveBeenCalledWith(['svc-a', 'svc-b'], 'NZD');
  });

  it('keeps an override in the draft across leaving the step and coming back, and it silences the missing-price alert', async () => {
    const first = render(<Harness currency="NZD" initial={[{ service_id: 'svc-b', service_name: 'Product B', quantity: 1 }]} />);
    await waitFor(() => expect(screen.getByText(NO_DEFAULT)).not.toBeNull());

    fireEvent.change(document.getElementById('product-rate-0')!, { target: { value: '42.50' } });
    expect(latestData.product_services[0].custom_rate).toBe(4250);
    expect(screen.queryByText(NO_DEFAULT)).toBeNull();

    const draft = latestData.product_services;
    first.unmount();
    render(<Harness currency="NZD" initial={draft} />);
    expect((document.getElementById('product-rate-0') as HTMLInputElement).value).toBe('42.50');
    expect(screen.queryByText(NO_DEFAULT)).toBeNull();
  });

  it('keeps each remaining row on its own price when the first of three products is removed', async () => {
    render(<Harness initial={[
      { service_id: 'svc-a', service_name: 'Product A', quantity: 1 },
      { service_id: 'svc-b', service_name: 'Product B', quantity: 1 },
      { service_id: 'svc-c', service_name: 'Product C', quantity: 1 },
    ]} />);

    await waitFor(() => expect(screen.getByTestId('product-catalog-price-2')).not.toBeNull());
    fireEvent.click(document.getElementById('remove-product-0')!);

    expect(screen.queryByText('Product A')).toBeNull();
    expect(screen.getByTestId('product-catalog-price-0').textContent).toBe('Catalog price in AUD: AUD 200.00');
    expect(screen.getByTestId('product-catalog-price-1').textContent).toBe('Catalog price in AUD: AUD 300.00');
    expect(screen.queryByText(NO_PRICE)).toBeNull();
    expect(screen.queryByText(NO_DEFAULT)).toBeNull();
  });

  it('prices a resumed draft row through the shared lookup, as Review does', async () => {
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
      { service_id: 'svc-a', service_name: 'Product A', quantity: 1 },
      { service_id: 'svc-b', service_name: 'Product B', quantity: 1 },
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
      { service_id: 'svc-a', service_name: 'Product A', quantity: 1 },
    ]} />);

    await waitFor(() => expect(screen.getByTestId('product-catalog-price-0')).not.toBeNull());
    expect(actionMocks.getServiceCatalogCostInfo).toHaveBeenCalled();
    expect(screen.queryByTestId('product-cost-0')).toBeNull();
    expect(screen.queryByText(/Cost/)).toBeNull();
  });
});
