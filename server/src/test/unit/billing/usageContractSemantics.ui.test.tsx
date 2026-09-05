/**
 * @vitest-environment jsdom
 *
 * UI smoke coverage for record-driven usage-contract semantics across contract
 * configuration, contract overview, Usage Tracking, and Contract Reports:
 * - authoring panels never show a quantity billing ignores and explain the
 *   usage-record prerequisite and minimum-floor semantics;
 * - the contract overview labels usage services "billed on recorded usage"
 *   and links to Usage Tracking instead of rendering a legacy quantity;
 * - Usage Tracking honors deep-link prefills;
 * - Contract Reports label variable usage revenue instead of presenting an
 *   active usage contract as bare zero MRR.
 * (Invoice preview's missing-usage state is covered behaviorally in
 * src/test/infrastructure/billing/invoices/usageRecordDrivenBilling.test.ts.)
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

(globalThis as unknown as { React?: typeof React }).React = React;

// Without an initialized i18next instance the real useTranslation returns an
// unstable `t`, which loops validation effects that depend on it. A stable
// defaultValue-interpolating stub keeps renders deterministic.
const stableT = (key: string, options?: Record<string, unknown>) => {
  const template = typeof options?.defaultValue === 'string' ? options.defaultValue : key;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(options?.[name] ?? `{{${name}}}`));
};
vi.mock('@alga-psa/ui/lib/i18n/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({ t: stableT, i18n: { language: 'en' } }),
}));

// UsageTracking calls useRouter() for the return-to-preview redirect; the unit
// render has no app router mounted, so stub the navigation hooks.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/msp/billing',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  getContractOverview: vi.fn(async () => ({
    contractLines: [
      {
        contract_line_id: 'line-usage',
        contract_line_name: 'Seats',
        contract_line_type: 'Usage',
        billing_frequency: 'monthly',
        base_rate: null,
        display_order: 0,
        services: [
          {
            service_id: 'svc-usage',
            service_name: 'Standard Seat',
            billing_method: 'usage',
            custom_rate: 10000,
            quantity: null,
            unit_of_measure: 'seat',
          },
        ],
      },
      {
        contract_line_id: 'line-fixed',
        contract_line_name: 'Base',
        contract_line_type: 'Fixed',
        billing_frequency: 'monthly',
        base_rate: 20000,
        display_order: 1,
        services: [
          {
            service_id: 'svc-fixed',
            service_name: 'Support',
            billing_method: 'fixed',
            custom_rate: null,
            quantity: 3,
            unit_of_measure: null,
          },
        ],
      },
    ],
    totalEstimatedMonthlyValue: 20000,
    serviceCount: 2,
    hasFixedServices: true,
    hasHourlyServices: false,
    hasUsageServices: true,
    currencyCode: 'USD',
  })),
}));

vi.mock('@alga-psa/billing/actions/contractReportActions', () => ({
  getContractRevenueReport: vi.fn(async () => [
    {
      contract_name: 'Good and Natural',
      client_id: 'client-1',
      client_name: 'Solutions by Swift',
      monthly_recurring: 0,
      total_billed_ytd: 0,
      has_variable_usage: true,
      currency_code: 'CAD',
      status: 'active',
    },
    {
      contract_name: 'Mixed Retainer',
      client_id: 'client-1',
      client_name: 'Solutions by Swift',
      monthly_recurring: 50000,
      total_billed_ytd: 100000,
      has_variable_usage: true,
      currency_code: 'CAD',
      status: 'active',
    },
  ]),
  getContractExpirationReport: vi.fn(async () => [
    {
      contract_name: 'Good and Natural',
      client_id: 'client-1',
      client_name: 'Solutions by Swift',
      end_date: '2027-01-01',
      days_until_expiration: 120,
      monthly_value: 0,
      has_variable_usage: true,
      currency_code: 'CAD',
      auto_renew: false,
    },
  ]),
  getBucketUsageReport: vi.fn(async () => []),
  getContractReportSummary: vi.fn(async () => ({
    fixedMrrByCurrency: [{ currencyCode: 'CAD', totalCents: 50000 }],
    ytdRevenueByCurrency: [{ currencyCode: 'CAD', totalCents: 100000 }],
    activeContractCount: 3,
    atRiskDecisionCount: 0,
    variableUsageContractCount: 2,
  })),
}));

vi.mock('@alga-psa/billing/actions/usageActions', () => ({
  getUsageRecords: vi.fn(async () => []),
  createUsageRecord: vi.fn(),
  updateUsageRecord: vi.fn(),
  deleteUsageRecord: vi.fn(),
  getEligibleContractLinesForUI: vi.fn(async () => []),
}));

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getAllClientsForBilling: vi.fn(async () => [
    { client_id: 'client-1', client_name: 'Solutions by Swift', is_inactive: false, client_type: 'company' },
  ]),
}));

vi.mock('@alga-psa/reporting/actions/report-actions/getRemainingBucketUnits', () => ({
  getRemainingBucketUnits: vi.fn(async () => []),
}));

// ProfitabilityReport pulls its own data stack; the reports smoke only cares
// about the summary tiles and revenue/expiration tables.
vi.mock('@alga-psa/billing/components/billing-dashboard/reports/ProfitabilityReport', () => ({
  default: () => null,
}));

// Radix Switch's ref composition loops under jsdom in this React version; the
// smoke only needs a toggle placeholder.
vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: (props: { id?: string; checked?: boolean }) => (
    <input type="checkbox" id={props.id} checked={props.checked ?? false} readOnly />
  ),
}));

import { BaseServiceConfigPanel } from '@alga-psa/billing/components/billing-dashboard/service-configurations/BaseServiceConfigPanel';
import { UsageServiceConfigPanel } from '@alga-psa/billing/components/billing-dashboard/service-configurations/UsageServiceConfigPanel';
import { ContractOverview } from '@alga-psa/billing/components/billing-dashboard/contracts/ContractOverview';
import ContractReports from '@alga-psa/billing/components/billing-dashboard/reports/ContractReports';
import UsageTracking from '@alga-psa/billing/components/billing-dashboard/UsageTracking';

afterEach(() => {
  cleanup();
});

describe('usage contract configuration panels', () => {
  it('hides the quantity input for Usage configurations', () => {
    render(
      <BaseServiceConfigPanel
        configuration={{ configuration_type: 'Usage', quantity: 10 }}
        onConfigurationChange={() => {}}
      />
    );

    expect(document.getElementById('service-quantity')).toBeNull();
  });

  it('keeps the quantity input for Fixed configurations', () => {
    render(
      <BaseServiceConfigPanel
        configuration={{ configuration_type: 'Fixed', quantity: 3 }}
        onConfigurationChange={() => {}}
      />
    );

    expect(document.getElementById('service-quantity')).not.toBeNull();
  });

  // Hoisted so prop identity is stable across renders: the panel re-syncs
  // internal state whenever the configuration object identity changes.
  const USAGE_PANEL_CONFIGURATION = { unit_of_measure: 'seat', minimum_usage: 5, enable_tiered_pricing: false };
  const NOOP = () => {};

  it('explains record-driven billing and the minimum-usage floor', () => {
    render(
      <UsageServiceConfigPanel
        configuration={USAGE_PANEL_CONFIGURATION}
        onConfigurationChange={NOOP}
      />
    );

    expect(screen.getByTestId('usage-config-record-driven-note').textContent)
      .toMatch(/no usage record produces no charge/i);
    expect(screen.getByText(/only applies when the period has a usage record/i)).toBeInTheDocument();
  });
});

describe('contract overview usage presentation', () => {
  it('labels usage services as billed on recorded usage and never shows a quantity', async () => {
    render(<ContractOverview contractId="contract-1" />);

    // Lines auto-expand once the overview loads.
    const hint = await screen.findByTestId('usage-recorded-usage-hint-svc-usage');
    expect(hint).toHaveTextContent(/billed on recorded usage/i);
    expect(hint).toHaveAttribute(
      'href',
      expect.stringContaining('tab=usage-tracking')
    );
    expect(screen.queryByText(/x10/)).toBeNull();

    // Fixed lines keep their quantity presentation.
    await screen.findByText('Support');
    expect(screen.getByText('x3')).toBeInTheDocument();
  });
});

describe('usage tracking deep-link prefill', () => {
  it('applies initial client and service filters', async () => {
    render(
      <UsageTracking
        initialServices={[
          {
            service_id: 'svc-usage',
            service_name: 'Standard Seat',
            billing_method: 'usage',
          } as never,
        ]}
        initialClientId="client-1"
        initialServiceId="svc-usage"
      />
    );

    // The service filter select surfaces the prefilled service.
    await waitFor(() => {
      expect(screen.getAllByText('Standard Seat').length).toBeGreaterThan(0);
    });
  });

  it('synchronizes filters when prefills arrive as a prop change after mount', async () => {
    // The billing dashboard renders this tab from a server-side query snapshot
    // and swaps to the live URL params on hydration without remounting, so the
    // prefills can land as a prop change rather than the initial props.
    const services = [
      {
        service_id: 'svc-usage',
        service_name: 'Standard Seat',
        billing_method: 'usage',
      } as never,
    ];

    const { rerender } = render(
      <UsageTracking initialServices={services} initialClientId={null} initialServiceId={null} />
    );

    await waitFor(() => {
      expect(screen.getAllByText('All Services').length).toBeGreaterThan(0);
    });

    rerender(
      <UsageTracking
        initialServices={services}
        initialClientId="client-1"
        initialServiceId="svc-usage"
      />
    );

    // Both filters follow the hydrated props: the client select shows the
    // prefilled client and the service select the prefilled service.
    await waitFor(() => {
      expect(screen.getAllByText('Standard Seat').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Solutions by Swift').length).toBeGreaterThan(0);
    });
  });
});

describe('contract reports variable usage labeling', () => {
  it('marks usage contracts as variable revenue instead of bare zero MRR', async () => {
    render(<ContractReports />);

    // A pure-usage contract row shows "Variable usage" instead of a fixed
    // zero; a mixed contract shows its fixed amount plus the variable label.
    const pureUsageLabels = await screen.findAllByText(/^Variable usage$/);
    expect(pureUsageLabels.length).toBeGreaterThan(0);
    const mixedLabels = screen.getAllByText(/\+ variable usage/);
    expect(mixedLabels.length).toBeGreaterThan(0);

    // The MRR tile is explicitly fixed recurring revenue and notes the
    // contracts that also bill variable usage.
    expect(screen.getByText(/Fixed Monthly Recurring Revenue/)).toBeInTheDocument();
    expect(screen.getByTestId('mrr-variable-usage-note').textContent)
      .toMatch(/2 active contracts also bill variable usage/);
  });

  it('aggregates summary MRR and YTD separately per contract currency', async () => {
    render(<ContractReports />);

    const mrrTile = await screen.findByTestId('fixed-mrr-by-currency');
    // CAD minor units formatted in CAD — never re-labeled in tenant currency.
    expect(mrrTile.textContent).toMatch(/CA\$500(\.00)?|500(\.|,)00\s*\$?\s*CA/);
    const ytdTile = screen.getByTestId('ytd-revenue-by-currency');
    expect(ytdTile.textContent).toMatch(/CA\$1,?000(\.00)?|1[.,\s]?000(\.|,)00/);
  });
});
