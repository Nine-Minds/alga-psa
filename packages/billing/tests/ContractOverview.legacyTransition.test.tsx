// @vitest-environment jsdom
//
// Legacy usage quantities stay visible as non-billing reference data, and the
// only way out of them is an explicit, prospective transition. This suite
// drives the real contract overview:
//
//  1. the legacy reference block offers both transition entry points;
//  2. opening one shows the legacy quantity/rate as unconfirmed reference and
//     writes nothing — cancelling leaves the measurement mode untouched;
//  3. confirming the period-count transition calls the guarded semantics
//     action, and a refused conversion is surfaced instead of silently
//     succeeding.

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getContractOverview: vi.fn(),
  setUsageMeasurementMode: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  getContractOverview: actionMocks.getContractOverview,
}));

vi.mock('@alga-psa/billing/actions/contractLineSemanticsActions', () => ({
  setUsageMeasurementMode: actionMocks.setUsageMeasurementMode,
  getNextContractServiceBoundary: vi.fn(async () => "2026-10-01"),
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
  useFormatters: () => ({
    formatCurrency: (amount: number, currencyCode: string) =>
      `${currencyCode} ${amount.toFixed(2)}`,
  }),
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useFormatBillingFrequency: () => (value: string) => value,
  useFormatContractLineType: () => (value: string) => value,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children, footer }: any) =>
    isOpen ? (
      <div role="dialog">
        <h1>{title}</h1>
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { ContractOverview } = await import(
  '../src/components/billing-dashboard/contracts/ContractOverview'
);

const usageOverview = {
  contractLines: [
    {
      contract_line_id: 'line-usage',
      contract_line_name: 'Managed Seats',
      contract_line_type: 'Usage',
      billing_frequency: 'monthly',
      base_rate: null,
      display_order: 0,
      services: [
        {
          service_id: 'svc-seat',
          service_name: 'Managed Seat',
          billing_method: 'usage',
          custom_rate: 8500,
          quantity: null,
          previouslyConfiguredQuantity: 9,
          unit_of_measure: 'seat',
          config_id: 'cfg-usage',
          pricing_basis: null,
          measurement_mode: 'additive',
          unit_rate: null,
        },
      ],
    },
  ],
  totalEstimatedMonthlyValue: null,
  serviceCount: 1,
  hasHourlyServices: false,
  hasUsageServices: true,
  hasFixedServices: false,
  currencyCode: 'CAD',
  clientId: 'client-1',
};

const renderOverview = async () => {
  render(<ContractOverview contractId="contract-1" />);
  await screen.findByTestId('usage-previously-configured-svc-seat');
};

describe('contract overview legacy usage transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getContractOverview.mockResolvedValue(structuredClone(usageOverview));
    actionMocks.setUsageMeasurementMode.mockResolvedValue({ measurement_mode: 'period_total' });
  });

  it('offers both transition entry points beside the non-billing legacy quantity', async () => {
    await renderOverview();

    expect(screen.getByText(/Previously configured quantity: 9 — not used for billing/)).toBeTruthy();
    expect(document.getElementById('usage-set-up-recurring-seats-svc-seat')).not.toBeNull();
    expect(document.getElementById('usage-report-period-count-svc-seat')).not.toBeNull();
  });

  it('writes nothing when a transition dialog is opened and cancelled', async () => {
    await renderOverview();

    fireEvent.click(document.getElementById('usage-report-period-count-svc-seat')!);

    const reference = await screen.findByTestId('legacy-transition-reference');
    expect(reference.textContent).toContain('Unconfirmed reference from the previous configuration');
    expect(reference.textContent).toContain('Previously configured quantity: 9');
    expect(reference.textContent).toContain('Saved rate: CAD 85.00');

    fireEvent.click(document.getElementById('usage-legacy-transition-cancel')!);

    await waitFor(() => {
      expect(screen.queryByTestId('legacy-transition-reference')).toBeNull();
    });
    expect(actionMocks.setUsageMeasurementMode).not.toHaveBeenCalled();
  });

  it('explains the recurring-seat move without writing anything', async () => {
    await renderOverview();

    fireEvent.click(document.getElementById('usage-set-up-recurring-seats-svc-seat')!);

    const guidance = await screen.findByTestId('legacy-transition-recurring-seats');
    expect(guidance.textContent).toContain('Fixed contract line priced by recurring seats/units');
    expect(guidance.textContent).toContain('does not convert or close this Usage service');
    expect(guidance.textContent).not.toContain('until you remove it');
    // There is no confirm button here: creating a seat commitment is authored
    // on the Fixed line, not silently from this dialog.
    expect(document.getElementById('usage-legacy-transition-confirm')).toBeNull();

    fireEvent.click(document.getElementById('usage-legacy-transition-cancel')!);
    expect(actionMocks.setUsageMeasurementMode).not.toHaveBeenCalled();
  });

  it('switches measurement mode only on explicit confirmation, and surfaces refusals', async () => {
    actionMocks.setUsageMeasurementMode.mockResolvedValue({
      actionError: 'This service still has unbilled additive entries on the contract line.',
    });

    await renderOverview();

    fireEvent.click(document.getElementById('usage-report-period-count-svc-seat')!);
    await waitFor(() => expect((screen.getByText('Switch to period counts') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Switch to period counts'));

    await waitFor(() => {
      expect(actionMocks.setUsageMeasurementMode).toHaveBeenCalledTimes(1);
    });
    expect(actionMocks.setUsageMeasurementMode.mock.calls[0][0]).toEqual({
      config_id: 'cfg-usage',
      contract_line_id: 'line-usage',
      service_id: 'svc-seat',
      measurement_mode: 'period_total',
      effective_period_start: '2026-10-01',
    });

    expect((await screen.findByTestId('legacy-transition-error')).textContent).toContain(
      'unbilled additive entries'
    );
  });
});
