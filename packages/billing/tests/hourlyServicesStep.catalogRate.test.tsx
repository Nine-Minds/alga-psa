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

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/BucketPoolDraftEditor', () => ({
  BucketPoolDraftEditor: () => null,
}));

vi.mock('@alga-psa/billing/actions/bucketPoolActions', () => ({
  listBucketBusinessHoursSchedules: vi.fn(async () => []),
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

import { HourlyServicesStep } from '../src/components/billing-dashboard/contracts/wizard-steps/HourlyServicesStep';

const baseData = (): any => ({
  client_id: 'client-1',
  contract_name: 'Managed',
  start_date: '2026-01-01',
  billing_frequency: 'monthly',
  currency_code: 'USD',
  fixed_services: [],
  hourly_services: [],
  enable_proration: true,
  cadence_owner: 'client',
  billing_timing: 'arrears',
});

function Harness({ initial = baseData() }: { initial?: any }) {
  const [data, setData] = useState(initial);
  return (
    <HourlyServicesStep
      data={data}
      updateData={(patch) => setData((prev) => ({ ...prev, ...patch }))}
    />
  );
}

const addServiceRow = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Add Hourly Service' }));
const rateInput = (index: number) =>
  document.getElementById(`hourly-rate-${index}`) as HTMLInputElement;

describe('HourlyServicesStep catalog rate resolution', () => {
  beforeEach(() => {
    picker.nextItem = null;
  });

  it('prefills default_rate and labels the catalog-default source when no currency price exists', async () => {
    render(<Harness />);
    addServiceRow();

    picker.nextItem = {
      service_id: 'service-1',
      service_name: 'Endpoint',
      billing_method: 'hourly',
      unit_of_measure: 'hour',
      item_kind: 'service',
      sku: null,
      default_rate: 18000,
      currency_rate: undefined,
      description: null,
    };
    fireEvent.click(document.getElementById('hourly-service-0')!);

    await waitFor(() => expect(rateInput(0).value).toBe('180.00'));
    expect(
      screen.getByText('No USD catalog price; using the catalog default rate.'),
    ).not.toBeNull();
  });

  it('prefers the exact contract-currency price and emits no fallback hint', async () => {
    render(<Harness />);
    addServiceRow();

    picker.nextItem = {
      service_id: 'service-1',
      service_name: 'Endpoint',
      billing_method: 'hourly',
      unit_of_measure: 'hour',
      item_kind: 'service',
      sku: null,
      default_rate: 18000,
      currency_rate: 25000,
      description: null,
    };
    fireEvent.click(document.getElementById('hourly-service-0')!);

    await waitFor(() => expect(rateInput(0).value).toBe('250.00'));
    expect(
      screen.queryByText('No USD catalog price; using the catalog default rate.'),
    ).toBeNull();
  });

  it('requires a manual rate when nothing resolves and drops the hint once edited', async () => {
    render(<Harness />);
    addServiceRow();

    picker.nextItem = {
      service_id: 'service-1',
      service_name: 'Unpriced',
      billing_method: 'hourly',
      unit_of_measure: 'hour',
      item_kind: 'service',
      sku: null,
      default_rate: null,
      currency_rate: null,
      description: null,
    };
    fireEvent.click(document.getElementById('hourly-service-0')!);

    await waitFor(() =>
      expect(
        screen.getByText('No USD price in the catalog. Enter an hourly rate.'),
      ).not.toBeNull(),
    );

    fireEvent.change(rateInput(0), { target: { value: '75.00' } });
    fireEvent.blur(rateInput(0));

    await waitFor(() =>
      expect(screen.queryByText('No USD price in the catalog. Enter an hourly rate.')).toBeNull(),
    );
  });
});
