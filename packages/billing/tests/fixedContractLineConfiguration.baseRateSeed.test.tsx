// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seed = vi.hoisted(() => ({
  totalCents: 0,
  callbacks: [] as Array<(total: number) => void>,
}));

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
    default: (props: {
      onServicesTotalResolved?: (total: number) => void;
      onServiceAdded?: () => void;
    }) => {
      if (props.onServicesTotalResolved) {
        seed.callbacks.push(props.onServicesTotalResolved);
      }
      return ReactModule.createElement(
        ReactModule.Fragment,
        null,
        ReactModule.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'report-services-total',
            onClick: () => props.onServicesTotalResolved?.(seed.totalCents),
          },
          'report',
        ),
        ReactModule.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'add-service',
            onClick: () => props.onServiceAdded?.(),
          },
          'add',
        ),
      );
    },
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
    seed.callbacks = [];
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

  it('T007: seeds from a service total reported before the empty fixed config resolves', async () => {
    let resolveConfig: (value: unknown) => void = () => {};
    actions.getContractLineFixedConfig.mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = resolve;
      }),
    );
    const { FixedPlanConfiguration } = await import(
      '../src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration'
    );

    render(<FixedPlanConfiguration contractLineId="line-1" />);

    // The plan header loads while the fixed config is still pending, so the
    // service list can report its total first.
    await screen.findByDisplayValue('Managed Support');
    seed.totalCents = 5000;
    fireEvent.click(screen.getByTestId('report-services-total'));
    await waitFor(() => expect(baseRateInput().value).toBe(''));

    // The config resolves empty: the held total must seed the field, and the
    // dirty flag must survive the load completing.
    resolveConfig({ base_rate: null, enable_proration: false, billing_cycle_alignment: 'start' });
    await waitFor(() => expect(baseRateInput().value).toBe('50.00'));
    const saveButton = screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);

    // The seeded rate must survive the empty-config assignment: saving has to
    // persist it rather than fail the required-base-rate validation.
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(actions.updateContractLineFixedConfig).toHaveBeenCalledWith(
        'line-1',
        expect.objectContaining({ base_rate: 5000 }),
      ),
    );
    expect(screen.queryByText('Base rate is required for fixed lines')).toBeNull();
  });

  it('T007: never replaces a populated persisted rate when the total arrives first', async () => {
    let resolveConfig: (value: unknown) => void = () => {};
    actions.getContractLineFixedConfig.mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = resolve;
      }),
    );
    const { FixedPlanConfiguration } = await import(
      '../src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration'
    );

    render(<FixedPlanConfiguration contractLineId="line-1" />);

    await screen.findByDisplayValue('Managed Support');
    seed.totalCents = 5000;
    fireEvent.click(screen.getByTestId('report-services-total'));
    await waitFor(() => expect(baseRateInput().value).toBe(''));

    // The config resolves populated: the held service total must be discarded.
    resolveConfig({ base_rate: 12000, enable_proration: false, billing_cycle_alignment: 'start' });
    await waitFor(() => expect(baseRateInput().value).toBe('120.00'));
  });

  it('T007: a populated persisted rate survives a service-total callback that follows it immediately', async () => {
    let resolveConfig: (value: unknown) => void = () => {};
    actions.getContractLineFixedConfig.mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = resolve;
      }),
    );
    const { FixedPlanConfiguration } = await import(
      '../src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration'
    );

    render(<FixedPlanConfiguration contractLineId="line-1" />);
    await screen.findByDisplayValue('Managed Support');
    expect(baseRateInput().value).toBe('');

    // Capture the service-total callback from the render where the base rate
    // was still empty. This is the stale closure the config load can leave
    // behind until React rerenders.
    const staleCallback = seed.callbacks[0];
    expect(staleCallback).toBeTypeOf('function');

    // The config resolves populated, then the stale callback fires before a
    // rerender refreshes it. The authoritative ref must already hold 120.00,
    // so the total cannot replace the persisted value.
    resolveConfig({ base_rate: 12000, enable_proration: false, billing_cycle_alignment: 'start' });
    await waitFor(() => expect(baseRateInput().value).toBe('120.00'));

    await act(async () => {
      staleCallback(5000);
    });

    expect(baseRateInput().value).toBe('120.00');
    expect(baseRateInput().value).not.toBe('50.00');
  });

  it('T007: preserves a manually entered base rate across a service-list refresh', async () => {
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

    fireEvent.change(baseRateInput(), { target: { value: '999.00' } });
    fireEvent.blur(baseRateInput());
    await waitFor(() => expect(baseRateInput().value).toBe('999.00'));

    // The service list reports its total and then triggers a refresh (as the
    // add/remove path does) against an empty persisted config.
    seed.totalCents = 5000;
    fireEvent.click(screen.getByTestId('report-services-total'));
    fireEvent.click(screen.getByTestId('add-service'));

    await waitFor(() => expect(actions.getContractLineFixedConfig).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(baseRateInput().value).toBe('999.00'));
    expect(baseRateInput().value).not.toBe('50.00');

    // The manual value must remain the authoritative rate: saving has to
    // persist 999.00 rather than losing it to the empty persisted config and
    // falling back to the catalog total (or failing validation).
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(actions.updateContractLineFixedConfig).toHaveBeenCalledWith(
        'line-1',
        expect.objectContaining({ base_rate: 99900 }),
      ),
    );
    expect(screen.queryByText('Base rate is required for fixed lines')).toBeNull();
  });
});
