// @vitest-environment jsdom

import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const picker = vi.hoisted(() => ({ nextItem: null as any }));

vi.mock('../src/components/billing-dashboard/contracts/ServiceCatalogPicker', () => ({
  ServiceCatalogPicker: ({ id, onSelect }: { id?: string; onSelect: (item: any) => void }) => (
    <button type="button" id={id} onClick={() => onSelect(picker.nextItem)}>
      picker
    </button>
  ),
}));

vi.mock('../src/components/billing-dashboard/contracts/BillingFrequencyOverrideSelect', () => ({
  BillingFrequencyOverrideSelect: () => null,
}));

vi.mock('../src/components/billing-dashboard/contracts/BucketOverlayFields', () => ({
  BucketOverlayFields: () => null,
}));

vi.mock('../src/components/billing-dashboard/contracts/recurringAuthoringPreview', () => ({
  getRecurringAuthoringPreview: () => ({
    cadenceOwnerLabel: '',
    cadenceOwnerSummary: '',
    billingTimingLabel: '',
    billingTimingSummary: '',
    firstInvoiceSummary: '',
    partialPeriodSummary: '',
    materializedPeriodsHeading: '',
    materializedPeriodsSummary: '',
    materializedPeriods: [],
  }),
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({
  SwitchWithLabel: () => null,
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useFormatBillingFrequency: () => (value: string) => value,
}));

vi.mock('@alga-psa/core', () => ({
  getCurrencySymbol: () => '$',
}));

const translate = (key: string, options?: Record<string, unknown>) => {
  let value = String(options?.defaultValue ?? key);
  for (const [name, replacement] of Object.entries(options ?? {})) {
    value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
}));

import { FixedFeeServicesStep } from '../src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep';

const baseData = (): any => ({
  client_id: 'client-1',
  contract_name: 'Managed',
  start_date: '2026-01-01',
  billing_frequency: 'monthly',
  currency_code: 'USD',
  fixed_services: [],
  fixed_base_rate: undefined,
  enable_proration: true,
  cadence_owner: 'client',
  billing_timing: 'arrears',
});

function Harness({ initial = baseData() }: { initial?: any }) {
  const [data, setData] = useState(initial);
  return (
    <FixedFeeServicesStep
      data={data}
      updateData={(patch) => setData((prev) => ({ ...prev, ...patch }))}
    />
  );
}

const addServiceRow = () => fireEvent.click(screen.getByRole('button', { name: 'Add Service' }));
const baseRateInput = () => document.getElementById('fixed_base_rate') as HTMLInputElement;
const quantityInput = (index: number) =>
  document.getElementById(`quantity-${index}`) as HTMLInputElement;

describe('FixedFeeServicesStep base rate suggestion', () => {
  beforeEach(() => {
    picker.nextItem = null;
  });

  it('T005: seeds the recurring base rate with the quantity-weighted resolved-rate sum and refreshes it', async () => {
    render(<Harness />);

    addServiceRow();
    picker.nextItem = {
      service_id: 'service-1',
      service_name: 'Endpoint',
      billing_method: 'fixed',
      unit_of_measure: 'unit',
      item_kind: 'service',
      sku: null,
      default_rate: 5000,
      currency_rate: 10000,
      description: null,
    };
    fireEvent.click(document.getElementById('service-select-0')!);
    await waitFor(() => expect(baseRateInput().value).toBe('100.00'));

    fireEvent.change(quantityInput(0), { target: { value: '2' } });
    await waitFor(() => expect(baseRateInput().value).toBe('200.00'));

    addServiceRow();
    picker.nextItem = {
      service_id: 'service-2',
      service_name: 'Backup',
      billing_method: 'fixed',
      unit_of_measure: 'unit',
      item_kind: 'service',
      sku: null,
      default_rate: 7000,
      currency_rate: undefined,
      description: null,
    };
    fireEvent.click(document.getElementById('service-select-1')!);
    await waitFor(() => expect(baseRateInput().value).toBe('270.00'));

    fireEvent.change(quantityInput(1), { target: { value: '3' } });
    await waitFor(() => expect(baseRateInput().value).toBe('410.00'));
  });

  it('T005: recomputes when a selected service is removed', async () => {
    render(<Harness />);

    addServiceRow();
    picker.nextItem = {
      service_id: 'service-1',
      service_name: 'Endpoint',
      billing_method: 'fixed',
      unit_of_measure: 'unit',
      item_kind: 'service',
      sku: null,
      default_rate: 9000,
      currency_rate: undefined,
      description: null,
    };
    fireEvent.click(document.getElementById('service-select-0')!);
    await waitFor(() => expect(baseRateInput().value).toBe('90.00'));

    addServiceRow();
    picker.nextItem = {
      service_id: 'service-2',
      service_name: 'Backup',
      billing_method: 'fixed',
      unit_of_measure: 'unit',
      item_kind: 'service',
      sku: null,
      default_rate: 4000,
      currency_rate: undefined,
      description: null,
    };
    fireEvent.click(document.getElementById('service-select-1')!);
    await waitFor(() => expect(baseRateInput().value).toBe('130.00'));

    fireEvent.click(document.getElementById('remove-fixed-service-1')!);
    await waitFor(() => expect(baseRateInput().value).toBe('90.00'));
  });

  it('T006: preserves a manually edited base rate across later quantity changes', async () => {
    render(<Harness />);

    addServiceRow();
    picker.nextItem = {
      service_id: 'service-1',
      service_name: 'Endpoint',
      billing_method: 'fixed',
      unit_of_measure: 'unit',
      item_kind: 'service',
      sku: null,
      default_rate: 10000,
      currency_rate: undefined,
      description: null,
    };
    fireEvent.click(document.getElementById('service-select-0')!);
    await waitFor(() => expect(baseRateInput().value).toBe('100.00'));

    fireEvent.change(baseRateInput(), { target: { value: '999.00' } });
    fireEvent.change(quantityInput(0), { target: { value: '5' } });

    await waitFor(() => expect(baseRateInput().value).toBe('999.00'));
  });

  it('T006: treats a resumed populated base rate as authoritative from mount', async () => {
    const initial = { ...baseData(), fixed_base_rate: 55000 };
    render(<Harness initial={initial} />);

    addServiceRow();
    picker.nextItem = {
      service_id: 'service-1',
      service_name: 'Endpoint',
      billing_method: 'fixed',
      unit_of_measure: 'unit',
      item_kind: 'service',
      sku: null,
      default_rate: 10000,
      currency_rate: undefined,
      description: null,
    };
    fireEvent.click(document.getElementById('service-select-0')!);

    await waitFor(() => expect(baseRateInput().value).toBe('550.00'));
  });

  it('T006: leaves the base rate empty when no selected service resolves a positive rate', async () => {
    render(<Harness />);

    addServiceRow();
    picker.nextItem = {
      service_id: 'service-1',
      service_name: 'Unpriced',
      billing_method: 'fixed',
      unit_of_measure: 'unit',
      item_kind: 'service',
      sku: null,
      default_rate: 0,
      currency_rate: null,
      description: null,
    };
    fireEvent.click(document.getElementById('service-select-0')!);

    await waitFor(() => expect(baseRateInput().value).toBe(''));
  });
});
