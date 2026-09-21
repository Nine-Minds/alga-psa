// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seed = vi.hoisted(() => ({ totalCents: 0 }));

const i18n = vi.hoisted(() => ({
  t: (key: string, options?: Record<string, unknown>) => {
    let value = String(options?.defaultValue ?? key);
    for (const [name, replacement] of Object.entries(options ?? {})) {
      value = value.replace(`{{${name}}}`, String(replacement));
    }
    return value;
  },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: i18n.t }),
}));

vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({
    symbol: () => '$',
    money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  }),
}));

vi.mock('../src/components/billing-dashboard/FixedContractLineServicesList', async () => {
  const ReactModule = await import('react');
  return {
    default: (props: { onServicesTotalResolved?: (total: number) => void }) =>
      ReactModule.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'report-services-total',
          onClick: () => props.onServicesTotalResolved?.(seed.totalCents),
        },
        'report',
      ),
  };
});

const actions = vi.hoisted(() => ({
  getContractLineById: vi.fn(),
  updateContractLine: vi.fn(),
  updateContractLineFixedConfig: vi.fn(),
  getContractLineFixedConfig: vi.fn(),
  getServices: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractLineAction', () => ({
  getContractLineById: actions.getContractLineById,
  updateContractLine: actions.updateContractLine,
  updateContractLineFixedConfig: actions.updateContractLineFixedConfig,
  getContractLineFixedConfig: actions.getContractLineFixedConfig,
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServices: actions.getServices,
}));

vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({
  useTenant: () => 'tenant-1',
}));

const baseLine = {
  contract_line_id: 'line-1',
  contract_line_name: 'Managed Support',
  billing_frequency: 'monthly',
  contract_line_type: 'Fixed',
  is_custom: true,
  billing_timing: 'arrears',
  cadence_owner: 'client',
};

const baseRateInput = () => document.getElementById('base-rate') as HTMLInputElement;

describe('FixedContractLineConfiguration base-rate seeding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed.totalCents = 0;
    actions.getContractLineById.mockResolvedValue({ ...baseLine });
    actions.updateContractLine.mockResolvedValue(undefined);
    actions.updateContractLineFixedConfig.mockResolvedValue(undefined);
    actions.getServices.mockResolvedValue({ services: [], totalCount: 0 });
  });

  it('T007: seeds an empty base-rate field from the resolved associated-service total', async () => {
    actions.getContractLineFixedConfig.mockResolvedValue({
      base_rate: null,
      enable_proration: false,
      billing_cycle_alignment: 'start',
    });
    const { FixedPlanConfiguration } = await import(
      '../src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration'
    );

    render(<FixedPlanConfiguration contractLineId="line-1" />);

    await screen.findByDisplayValue('Managed Support');
    await waitFor(() => expect(baseRateInput().value).toBe(''));

    seed.totalCents = 5000;
    fireEvent.click(screen.getByTestId('report-services-total'));

    await waitFor(() => expect(baseRateInput().value).toBe('50.00'));
    expect((screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('T007: never replaces a populated base rate with the service total', async () => {
    actions.getContractLineFixedConfig.mockResolvedValue({
      base_rate: 12000,
      enable_proration: false,
      billing_cycle_alignment: 'start',
    });
    const { FixedPlanConfiguration } = await import(
      '../src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration'
    );

    render(<FixedPlanConfiguration contractLineId="line-1" />);

    await waitFor(() => expect(baseRateInput().value).toBe('120.00'));

    seed.totalCents = 5000;
    fireEvent.click(screen.getByTestId('report-services-total'));

    await waitFor(() => expect(baseRateInput().value).toBe('120.00'));
  });

  it('T007: does not seed from a zero service total', async () => {
    actions.getContractLineFixedConfig.mockResolvedValue({
      base_rate: null,
      enable_proration: false,
      billing_cycle_alignment: 'start',
    });
    const { FixedPlanConfiguration } = await import(
      '../src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration'
    );

    render(<FixedPlanConfiguration contractLineId="line-1" />);
    await screen.findByDisplayValue('Managed Support');

    seed.totalCents = 0;
    fireEvent.click(screen.getByTestId('report-services-total'));

    await waitFor(() => expect(baseRateInput().value).toBe(''));
  });
});
