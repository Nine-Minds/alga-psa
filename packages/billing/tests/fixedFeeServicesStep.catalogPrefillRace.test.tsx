// @vitest-environment jsdom
//
// A per-seat service that arrives without a unit rate gets its catalog price
// once `getServiceCatalogRatesForCurrency` resolves. The operator keeps editing
// while that request is pending, so the prefill has to be applied to the wizard
// state as it is when the rates arrive - never to the copy captured when the
// request started. This suite renders the real step inside a stateful harness
// that uses the same shallow-merge `updateData` as ContractWizard, holds the
// catalog request open with a hand-resolved promise, edits during the wait, and
// checks what survives.

import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const catalogMocks = vi.hoisted(() => ({
  getServiceCatalogRatesForCurrency: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServiceCatalogRatesForCurrency: catalogMocks.getServiceCatalogRatesForCurrency,
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
    money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
    symbol: () => '$',
  }),
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useFormatBillingFrequency: () => (value: string) => value,
  useBillingFrequencyOptions: () => [],
}));

vi.mock('../src/components/billing-dashboard/contracts/ServiceCatalogPicker', () => ({
  ServiceCatalogPicker: ({ id }: { id: string }) => <div data-testid={id} />,
}));

vi.mock('../src/components/billing-dashboard/contracts/BucketOverlayFields', () => ({
  BucketOverlayFields: () => null,
}));

vi.mock('../src/components/billing-dashboard/contracts/BillingFrequencyOverrideSelect', () => ({
  BillingFrequencyOverrideSelect: () => null,
}));

import { FixedFeeServicesStep } from '../src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep';
import type { ContractWizardData } from '../src/components/billing-dashboard/contracts/ContractWizard';

type FixedService = ContractWizardData['fixed_services'][number];

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

let latestData: ContractWizardData;

// Same contract as ContractWizard.updateData: a shallow merge into the latest
// state, with the functional form resolved against that same latest state.
function Harness({ initialServices }: { initialServices: FixedService[] }) {
  const [data, setData] = useState<ContractWizardData>(
    () =>
      ({
        currency_code: 'USD',
        billing_frequency: 'monthly',
        enable_proration: false,
        fixed_services: initialServices,
      }) as unknown as ContractWizardData,
  );
  latestData = data;
  const updateData = (update: any) => {
    setData((prev) => ({ ...prev, ...(typeof update === 'function' ? update(prev) : update) }));
  };
  return <FixedFeeServicesStep data={data} updateData={updateData} />;
}

const seatRow = (overrides: Partial<FixedService> = {}): FixedService => ({
  service_id: 'svc-seat',
  service_name: 'Seat',
  quantity: 20,
  pricing_basis: 'unit',
  unit_rate: null,
  ...overrides,
});

describe('FixedFeeServicesStep catalog prefill race', () => {
  let request: Deferred<Record<string, number | null>>;

  beforeEach(() => {
    request = deferred();
    catalogMocks.getServiceCatalogRatesForCurrency.mockReset();
    catalogMocks.getServiceCatalogRatesForCurrency.mockReturnValue(request.promise);
  });

  const resolveCatalog = async (rates: Record<string, number | null>) => {
    await act(async () => {
      request.resolve(rates);
      await request.promise;
    });
  };

  it('keeps a seat quantity edited while the catalog request is pending and still fills the rate', async () => {
    render(<Harness initialServices={[seatRow()]} />);
    await waitFor(() => expect(catalogMocks.getServiceCatalogRatesForCurrency).toHaveBeenCalledTimes(1));

    fireEvent.change(document.getElementById('quantity-0') as HTMLInputElement, { target: { value: '23' } });
    expect(latestData.fixed_services[0].quantity).toBe(23);

    await resolveCatalog({ 'svc-seat': 1500 });

    await waitFor(() => expect(latestData.fixed_services[0].unit_rate).toBe(1500));
    expect(latestData.fixed_services[0].quantity).toBe(23);
    expect((document.getElementById('quantity-0') as HTMLInputElement).value).toBe('23');
  });

  it('keeps a unit rate the operator typed while the request is pending', async () => {
    render(<Harness initialServices={[seatRow()]} />);
    await waitFor(() => expect(catalogMocks.getServiceCatalogRatesForCurrency).toHaveBeenCalledTimes(1));

    fireEvent.change(document.getElementById('wizard-fixed-0-fixed-service-unit-rate') as HTMLInputElement, {
      target: { value: '9.99' },
    });
    expect(latestData.fixed_services[0].unit_rate).toBe(999);

    await resolveCatalog({ 'svc-seat': 1500 });

    await act(async () => {});
    expect(latestData.fixed_services[0].unit_rate).toBe(999);
    expect(latestData.fixed_services[0].quantity).toBe(20);
  });

  it('keeps a row added while the request is pending', async () => {
    render(<Harness initialServices={[seatRow()]} />);
    await waitFor(() => expect(catalogMocks.getServiceCatalogRatesForCurrency).toHaveBeenCalledTimes(1));

    fireEvent.click(document.getElementById('add-fixed-service-button') as HTMLElement);
    expect(latestData.fixed_services).toHaveLength(2);

    await resolveCatalog({ 'svc-seat': 1500 });

    await waitFor(() => expect(latestData.fixed_services[0].unit_rate).toBe(1500));
    expect(latestData.fixed_services).toHaveLength(2);
    expect(latestData.fixed_services[1]).toMatchObject({ service_id: '', pricing_basis: 'bundle', quantity: 1 });
  });

  it('keeps another row switched to allocation while the request is pending', async () => {
    render(
      <Harness
        initialServices={[
          seatRow(),
          seatRow({ service_id: 'svc-other', service_name: 'Other', quantity: 5, unit_rate: 700 }),
        ]}
      />,
    );
    await waitFor(() => expect(catalogMocks.getServiceCatalogRatesForCurrency).toHaveBeenCalledTimes(1));

    const radio = document.querySelector(
      'input[name="wizard-fixed-1-fixed-pricing-basis"][value="bundle"]',
    ) as HTMLInputElement;
    fireEvent.click(radio);
    expect(latestData.fixed_services[1].pricing_basis).toBe('bundle');

    await resolveCatalog({ 'svc-seat': 1500 });

    await waitFor(() => expect(latestData.fixed_services[0].unit_rate).toBe(1500));
    expect(latestData.fixed_services[1]).toMatchObject({ pricing_basis: 'bundle', quantity: 5 });
  });

  it('does not fill a row that was switched to allocation while its rate was pending', async () => {
    render(<Harness initialServices={[seatRow()]} />);
    await waitFor(() => expect(catalogMocks.getServiceCatalogRatesForCurrency).toHaveBeenCalledTimes(1));

    const radio = document.querySelector(
      'input[name="wizard-fixed-0-fixed-pricing-basis"][value="bundle"]',
    ) as HTMLInputElement;
    fireEvent.click(radio);
    expect(latestData.fixed_services[0].pricing_basis).toBe('bundle');

    await resolveCatalog({ 'svc-seat': 1500 });

    await act(async () => {});
    expect(latestData.fixed_services[0].pricing_basis).toBe('bundle');
    expect(latestData.fixed_services[0].unit_rate ?? null).toBeNull();
  });

  it('keeps a stored zero quantity at zero through the prefill', async () => {
    render(<Harness initialServices={[seatRow({ quantity: 0 })]} />);
    await waitFor(() => expect(catalogMocks.getServiceCatalogRatesForCurrency).toHaveBeenCalledTimes(1));

    await resolveCatalog({ 'svc-seat': 1500 });

    await waitFor(() => expect(latestData.fixed_services[0].unit_rate).toBe(1500));
    expect(latestData.fixed_services[0].quantity).toBe(0);
  });
});
