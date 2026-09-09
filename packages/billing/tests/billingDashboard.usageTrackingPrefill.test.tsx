/**
 * @vitest-environment jsdom
 *
 * Dashboard-side coverage for Usage Tracking deep-link prefills: the
 * initialQuery snapshot the server page builds (see
 * server/src/test/unit/app/billingPageUsageTrackingPrefill.test.tsx) and the
 * live URL params after hydration must both reach UsageTracking as
 * initialClientId/initialServiceId. Before the fix the snapshot lacked both
 * keys, so the pre-hydration render mounted the filters as "All Clients /
 * All Services" and the state never caught up.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const usageTrackingProps: Array<Record<string, unknown>> = [];
const liveSearchParams = { current: new URLSearchParams('tab=usage-tracking') };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => liveSearchParams.current,
}));

vi.mock('@alga-psa/auth/hooks/useAccountingCapabilities', () => ({
  useAccountingCapabilities: () => ({
    catalogRead: false,
    connectionsManage: false,
    mappingsManage: false,
    exportsExecute: false,
    remoteMutate: false,
    hasAny: false,
    loaded: true,
  }),
}));

vi.mock('../src/components/billing-dashboard/UsageTracking', () => ({
  default: (props: Record<string, unknown>) => {
    usageTrackingProps.push(props);
    return <div data-testid="usage-tracking-probe" />;
  },
}));

vi.mock('../src/components/billing-dashboard/accounting/AccountingExportsTab', () => ({
  default: () => null,
  AccountingExportsAccessDenied: () => null,
}));
vi.mock('../src/components/billing-dashboard/contract-lines/ContractLinesOverview', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/InvoiceTemplates', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/InvoiceTemplateEditor', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/BillingCycles', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/RecurringServicePeriodsTab', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/TaxRates', () => ({ default: () => null }));
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

const { default: BillingDashboard } = await import(
  '../src/components/billing-dashboard/BillingDashboard'
);

describe('BillingDashboard usage-tracking prefill routing', () => {
  beforeEach(() => {
    usageTrackingProps.length = 0;
    liveSearchParams.current = new URLSearchParams('tab=usage-tracking');
  });

  afterEach(() => cleanup());

  it('passes initialQuery prefills to UsageTracking on the pre-hydration render', async () => {
    liveSearchParams.current = new URLSearchParams(
      'tab=usage-tracking&clientId=client-emerald&serviceId=svc-rabbit-tracking&periodStart=2026-09-01&periodEnd=2026-10-01',
    );

    render(
      <BillingDashboard
        initialServices={[]}
        initialQuery={{
          tab: 'usage-tracking',
          clientId: 'client-emerald',
          serviceId: 'svc-rabbit-tracking',
          periodStart: '2026-09-01',
          periodEnd: '2026-10-01',
        }}
      />,
    );

    await waitFor(() => {
      expect(usageTrackingProps.length).toBeGreaterThan(0);
    });

    // The server-snapshot render (first mount, before the hydration effect
    // swaps to live URL params) must already carry the prefills — this is the
    // render that seeds UsageTracking's filter state.
    expect(usageTrackingProps[0]).toMatchObject({
      initialClientId: 'client-emerald',
      initialServiceId: 'svc-rabbit-tracking',
      initialPeriodStart: '2026-09-01',
      initialPeriodEnd: '2026-10-01',
    });
    // And the post-hydration render keeps them.
    expect(usageTrackingProps[usageTrackingProps.length - 1]).toMatchObject({
      initialClientId: 'client-emerald',
      initialServiceId: 'svc-rabbit-tracking',
      initialPeriodStart: '2026-09-01',
      initialPeriodEnd: '2026-10-01',
    });
  });

  it('delivers prefills that only exist in the live URL once hydrated', async () => {
    liveSearchParams.current = new URLSearchParams(
      'tab=usage-tracking&clientId=client-emerald&serviceId=svc-rabbit-tracking&periodStart=2026-09-01&periodEnd=2026-10-01',
    );

    // Simulates a stale/partial server snapshot: the live URL still wins after
    // hydration, so UsageTracking receives the prefills as a prop change.
    render(
      <BillingDashboard initialServices={[]} initialQuery={{ tab: 'usage-tracking' }} />,
    );

    await waitFor(() => {
      const latest = usageTrackingProps[usageTrackingProps.length - 1];
      expect(latest).toMatchObject({
        initialClientId: 'client-emerald',
        initialServiceId: 'svc-rabbit-tracking',
        initialPeriodStart: '2026-09-01',
        initialPeriodEnd: '2026-10-01',
      });
    });
  });
});
