// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultContractWizardData } from '../ContractWizard';

/**
 * Fixed-fee lines default to arrears, which means a new contract has nothing to
 * invoice until its first period ends. The step offers a one-click switch to
 * advance billing on the contract's cadence — the default itself is unchanged.
 */

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const fallback = (options?.defaultValue as string) ?? key;
      return fallback.replace(/{{(\w+)}}/g, (_match, token) => String(options?.[token] ?? ''));
    },
  }),
  useOptionalI18n: () => null,
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useFormatBillingFrequency: () => (value: string) => value,
}));
vi.mock('@alga-psa/core', () => ({
  getCurrencySymbol: () => '$',
  currencyFractionDigits: () => 2,
}));
vi.mock('../ServiceCatalogPicker', () => ({
  ServiceCatalogPicker: () => <div data-testid="service-picker" />,
}));
vi.mock('../BillingFrequencyOverrideSelect', () => ({
  BillingFrequencyOverrideSelect: () => <div />,
}));

const { FixedFeeServicesStep } = await import('./FixedFeeServicesStep');

const withService = (overrides: Record<string, unknown> = {}) => ({
  ...createDefaultContractWizardData(),
  fixed_lines: [
    {
      line_key: 'line-1',
      enable_proration: true,
      base_rate: null,
      services: [
        { service_id: 'svc-1', service_name: 'Managed Services', quantity: 1, pricing_basis: 'bundle' as const },
      ],
    },
  ],
  ...overrides,
});

describe('FixedFeeServicesStep advance-billing suggestion', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps arrears as the default and offers the switch', () => {
    const data = withService();
    expect(data.billing_timing).toBe('arrears');

    render(<FixedFeeServicesStep data={data} updateData={vi.fn()} />);

    expect(screen.getByText(/can't be invoiced until its first service period ends/)).toBeTruthy();
    expect(document.getElementById('fixed-fee-bill-in-advance-on-contract-cadence')).not.toBeNull();
  });

  it('one click sets both billing timing and cadence owner, and nothing else', () => {
    const updateData = vi.fn();
    render(<FixedFeeServicesStep data={withService()} updateData={updateData} />);

    fireEvent.click(document.getElementById('fixed-fee-bill-in-advance-on-contract-cadence')!);

    expect(updateData).toHaveBeenCalledTimes(1);
    expect(updateData).toHaveBeenCalledWith({ billing_timing: 'advance', cadence_owner: 'contract' });
  });

  it('is offered for client cadence too, since the switch moves the line to contract cadence', () => {
    render(
      <FixedFeeServicesStep
        data={withService({ cadence_owner: 'client', billing_timing: 'arrears' })}
        updateData={vi.fn()}
      />,
    );

    expect(document.getElementById('fixed-fee-advance-suggestion')).not.toBeNull();
  });

  it('is hidden once the line already bills in advance', () => {
    render(
      <FixedFeeServicesStep
        data={withService({ billing_timing: 'advance', cadence_owner: 'contract' })}
        updateData={vi.fn()}
      />,
    );

    expect(document.getElementById('fixed-fee-advance-suggestion')).toBeNull();
  });

  it('is hidden when contract cadence does not support the billing frequency', () => {
    render(
      <FixedFeeServicesStep
        data={withService({ billing_frequency: 'weekly' })}
        updateData={vi.fn()}
      />,
    );

    expect(document.getElementById('fixed-fee-advance-suggestion')).toBeNull();
  });

  it('is hidden until a fixed-fee service has been added', () => {
    render(
      <FixedFeeServicesStep data={withService({ fixed_lines: [{ line_key: 'line-1', enable_proration: true, base_rate: null, services: [] }] })} updateData={vi.fn()} />,
    );

    expect(document.getElementById('fixed-fee-advance-suggestion')).toBeNull();
  });
});
