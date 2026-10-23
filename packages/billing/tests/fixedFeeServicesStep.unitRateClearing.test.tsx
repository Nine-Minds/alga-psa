// @vitest-environment jsdom
//
// The catalog price prefills a per-unit row that has never had a rate. Once the
// operator empties the field it must stay empty while they type the
// replacement (backspacing "90" used to refill "100.00"), and an empty rate
// must be rejected by the same basis validation the wizard step and submission
// use rather than silently becoming the catalog price or 0.

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
  ServiceCatalogPicker: ({ id, onSelect }: { id: string; onSelect: (item: unknown) => void }) => (
    <button
      type="button"
      id={id}
      onClick={() =>
        onSelect({ service_id: 'svc-seat', service_name: 'Seat', currency_rate: 10000 })
      }
    >
      pick
    </button>
  ),
}));

vi.mock('../src/components/billing-dashboard/contracts/BucketOverlayFields', () => ({
  BucketOverlayFields: () => null,
}));

vi.mock('../src/components/billing-dashboard/contracts/BillingFrequencyOverrideSelect', () => ({
  BillingFrequencyOverrideSelect: () => null,
}));

import { FixedFeeServicesStep } from '../src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep';
import type { ContractWizardData } from '../src/components/billing-dashboard/contracts/ContractWizard';
import { getFixedServiceBasisIssue } from '../src/lib/fixedServiceBasis';

type FixedService = ContractWizardData['fixed_lines'][number]['services'][number];

let latestData: ContractWizardData;

// Same contract as ContractWizard.updateData: shallow merge into the latest state.
function Harness({ initialServices }: { initialServices: FixedService[] }) {
  const [data, setData] = useState<ContractWizardData>(
    () =>
      ({
        currency_code: 'USD',
        billing_frequency: 'monthly',
        enable_proration: false,
        fixed_lines: [{ line_key: 'line-1', enable_proration: true, base_rate: null, services: initialServices }],
      }) as unknown as ContractWizardData,
  );
  latestData = data;
  const updateData = (update: any) => {
    setData((prev) => ({ ...prev, ...(typeof update === 'function' ? update(prev) : update) }));
  };
  return <FixedFeeServicesStep data={data} updateData={updateData} />;
}

const rateInput = () =>
  document.getElementById('wizard-fixed-0-0-fixed-service-unit-rate') as HTMLInputElement;
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
};

describe('FixedFeeServicesStep unit rate clearing', () => {
  beforeEach(() => {
    catalogMocks.getServiceCatalogRatesForCurrency.mockReset();
    catalogMocks.getServiceCatalogRatesForCurrency.mockImplementation(async () => ({ 'svc-seat': 10000 }));
  });

  it('prefills once, stays empty when cleared, accepts a typed rate, and rejects an empty rate', async () => {
    render(
      <Harness
        initialServices={[
          { service_id: '', service_name: '', quantity: 20, pricing_basis: 'unit', unit_rate: undefined },
        ]}
      />,
    );

    fireEvent.click(document.getElementById('fixed-line-0-service-select-0') as HTMLElement);
    await flush();
    expect(latestData.fixed_lines[0].services[0].unit_rate).toBe(10000);
    expect(rateInput().value).toBe('100.00');

    // Backspace "90" down to nothing: first the digits, then the empty field.
    fireEvent.change(rateInput(), { target: { value: '90' } });
    expect(latestData.fixed_lines[0].services[0].unit_rate).toBe(9000);
    fireEvent.change(rateInput(), { target: { value: '9' } });
    expect(latestData.fixed_lines[0].services[0].unit_rate).toBe(900);
    fireEvent.change(rateInput(), { target: { value: '' } });
    await flush();

    expect(rateInput().value).toBe('');
    expect(latestData.fixed_lines[0].services[0].unit_rate ?? null).toBeNull();
    // An emptied rate is not a valid row: wizard validation and submission both
    // go through this check, so it can never submit as 0 or as the catalog rate.
    expect(getFixedServiceBasisIssue(latestData.fixed_lines[0].services[0])).toBe('unit_rate_required');
    // It is not re-fetched/refilled behind the operator's back either.
    expect(catalogMocks.getServiceCatalogRatesForCurrency).not.toHaveBeenCalled();

    fireEvent.change(rateInput(), { target: { value: '9' } });
    fireEvent.change(rateInput(), { target: { value: '90' } });
    await flush();
    expect(rateInput().value).toBe('90');
    expect(latestData.fixed_lines[0].services[0].unit_rate).toBe(9000);
    expect(getFixedServiceBasisIssue(latestData.fixed_lines[0].services[0])).toBeNull();
  });

  it('still prefills a row that arrives without a rate, then leaves it empty once cleared', async () => {
    render(
      <Harness
        initialServices={[
          { service_id: 'svc-seat', service_name: 'Seat', quantity: 3, pricing_basis: 'unit', unit_rate: null },
        ]}
      />,
    );
    await waitFor(() => expect(latestData.fixed_lines[0].services[0].unit_rate).toBe(10000));
    expect(catalogMocks.getServiceCatalogRatesForCurrency).toHaveBeenCalledTimes(1);

    fireEvent.change(rateInput(), { target: { value: '' } });
    await flush();
    expect(rateInput().value).toBe('');
    expect(latestData.fixed_lines[0].services[0].unit_rate ?? null).toBeNull();
    expect(catalogMocks.getServiceCatalogRatesForCurrency).toHaveBeenCalledTimes(1);
  });
});
