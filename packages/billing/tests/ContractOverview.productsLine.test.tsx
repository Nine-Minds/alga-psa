// @vitest-environment jsdom
//
// Products contracts (alga-2026-0002714): a Fixed line whose members are catalog
// products is billed quantity x rate, so the overview must
//  1. never print the historical line rate of 0 (A$0.00) as the line amount --
//     it prints the server-resolved recurring amount, or nothing;
//  2. caption product members as recurring seats, never as an "allocation of the
//     bundle price", even for a legacy row still stored as pricing_basis 'bundle';
//  3. leave a genuine bundle line (real non-zero line rate) exactly as it was.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getContractOverview: vi.fn(),
  setUsageMeasurementMode: vi.fn(),
}));

vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: true, loading: false, error: null }),
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

const service = (overrides: Record<string, unknown>) => ({
  service_id: 'svc',
  service_name: 'Service',
  billing_method: 'fixed',
  item_kind: null,
  custom_rate: null,
  quantity: 1,
  previouslyConfiguredQuantity: null,
  unit_of_measure: null,
  config_id: 'cfg',
  pricing_basis: null,
  measurement_mode: null,
  unit_rate: null,
  ...overrides,
});

const line = (overrides: Record<string, unknown>) => ({
  contract_line_id: 'line',
  contract_line_name: 'Line',
  contract_line_type: 'Fixed',
  billing_frequency: 'monthly',
  base_rate: null,
  recurring_amount: null,
  display_order: 0,
  services: [],
  ...overrides,
});

const overviewOf = (lines: unknown[]) => ({
  contractLines: lines,
  totalEstimatedMonthlyValue: 0,
  serviceCount: 1,
  hasHourlyServices: false,
  hasUsageServices: false,
  hasFixedServices: true,
  currencyCode: 'AUD',
  clientId: 'client-1',
});

const renderExpanded = async (lines: unknown[], lineName: string) => {
  actionMocks.getContractOverview.mockResolvedValue(overviewOf(lines));
  render(<ContractOverview contractId="contract-1" />);
  const header = await screen.findByText(lineName);
  // Lines load expanded.
  return header.closest('div.border') as HTMLElement;
};

describe('contract overview products lines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prints the member-derived amount, never the 0 placeholder line rate', async () => {
    const card = await renderExpanded(
      [
        line({
          contract_line_name: 'Products',
          base_rate: 0,
          recurring_amount: 215490,
          services: [
            service({ service_id: 'p1', item_kind: 'product', pricing_basis: 'unit', quantity: 5, unit_rate: 16098 }),
          ],
        }),
      ],
      'Products',
    );
    expect(card.textContent).toContain('AUD 2154.90');
    expect(card.textContent).not.toContain('AUD 0.00');
  });

  it('prints no amount at all when a products line has none resolved (never AUD 0.00)', async () => {
    const card = await renderExpanded(
      [
        line({
          contract_line_name: 'Products',
          base_rate: 0,
          recurring_amount: null,
          services: [service({ service_id: 'p1', item_kind: 'product', pricing_basis: 'unit', quantity: 2 })],
        }),
      ],
      'Products',
    );
    expect(card.textContent).not.toContain('AUD 0.00');
  });

  it('captions unit product members as seats, never as a bundle allocation (incl. legacy bundle rows)', async () => {
    await renderExpanded(
      [
        line({
          contract_line_name: 'Products',
          recurring_amount: 200000,
          services: [
            service({ service_id: 'p-unit', item_kind: 'product', pricing_basis: 'unit', quantity: 5, unit_rate: 16098 }),
            service({ service_id: 'p-legacy', item_kind: 'product', pricing_basis: 'bundle', quantity: 3, unit_rate: 9000 }),
          ],
        }),
      ],
      'Products',
    );
    expect(await screen.findByTestId('fixed-recurring-seats-p-unit')).toBeTruthy();
    expect(await screen.findByTestId('fixed-recurring-seats-p-legacy')).toBeTruthy();
    expect(screen.queryByTestId('fixed-bundle-allocation-p-unit')).toBeNull();
    expect(screen.queryByTestId('fixed-bundle-allocation-p-legacy')).toBeNull();
    expect(document.body.textContent).not.toContain('not billable seats');
  });

  it('leaves a genuine bundle line unchanged: its own rate and the allocation caption', async () => {
    const card = await renderExpanded(
      [
        line({
          contract_line_name: 'Managed Bundle',
          base_rate: 120000,
          recurring_amount: null,
          services: [service({ service_id: 'svc-bundle', item_kind: 'service', pricing_basis: 'bundle', quantity: 4 })],
        }),
      ],
      'Managed Bundle',
    );
    expect(card.textContent).toContain('AUD 1200.00');
    expect(await screen.findByTestId('fixed-bundle-allocation-svc-bundle')).toBeTruthy();
    expect(screen.queryByTestId('fixed-recurring-seats-svc-bundle')).toBeNull();
  });
});
