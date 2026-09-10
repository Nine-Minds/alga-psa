/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const capabilitiesState = vi.hoisted(() => ({
  current: {
    catalogRead: false,
    connectionsManage: false,
    mappingsManage: false,
    exportsExecute: false,
    remoteMutate: false,
    hasAny: false,
    loaded: true,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=accounting-exports'),
}));

vi.mock('@alga-psa/auth/hooks/useAccountingCapabilities', () => ({
  useAccountingCapabilities: () => capabilitiesState.current,
}));

vi.mock('../src/components/billing-dashboard/accounting/AccountingExportsTab', () => ({
  default: () => <button type="button">Functional export control</button>,
  AccountingExportsAccessDenied: () => (
    <div role="alert">Access denied. You do not have permission to access accounting exports.</div>
  ),
}));

vi.mock('../src/components/billing-dashboard/contract-lines/ContractLinesOverview', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/InvoiceTemplates', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/InvoiceTemplateEditor', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/BillingCycles', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/RecurringServicePeriodsTab', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/TaxRates', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/UsageTracking', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/contracts/TemplatesTab', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/contracts/ClientContractsTab', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/contracts/ContractDetailSwitcher', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/contract-lines/ContractLinePresetTypeRouter', () => ({ ContractLinePresetTypeRouter: () => null }));
vi.mock('../src/components/billing-dashboard/reports/ContractReports', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/InvoicingHub', () => ({ default: () => null }));
vi.mock('../src/components/settings/billing/ServiceCatalogManager', () => ({ default: () => null }));
vi.mock('../src/components/settings/billing/ProductsManager', () => ({ default: () => null }));
vi.mock('../src/components/settings/billing/ServiceTypeSettings', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/quotes/QuotesTab', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/quotes/QuoteDocumentTemplatesPage', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/quotes/QuoteTemplatesList', () => ({ default: () => null }));

describe('BillingDashboard Accounting Exports direct URL guard', () => {
  beforeEach(() => {
    capabilitiesState.current = {
      catalogRead: false,
      connectionsManage: false,
      mappingsManage: false,
      exportsExecute: false,
      remoteMutate: false,
      hasAny: false,
      loaded: true,
    };
  });

  afterEach(() => cleanup());

  it('blocks the functional exports tab for a direct URL without exports_execute', async () => {
    const { default: BillingDashboard } = await import(
      '../src/components/billing-dashboard/BillingDashboard'
    );

    render(<BillingDashboard initialServices={[]} initialQuery={{ tab: 'accounting-exports' }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByRole('button', { name: 'Functional export control' })).not.toBeInTheDocument();
  });

  it('mounts the functional exports tab for an exports_execute-capable Finance user', async () => {
    capabilitiesState.current = {
      ...capabilitiesState.current,
      catalogRead: true,
      exportsExecute: true,
      hasAny: true,
    };
    const { default: BillingDashboard } = await import(
      '../src/components/billing-dashboard/BillingDashboard'
    );

    render(<BillingDashboard initialServices={[]} initialQuery={{ tab: 'accounting-exports' }} />);

    expect(screen.getByRole('button', { name: 'Functional export control' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
