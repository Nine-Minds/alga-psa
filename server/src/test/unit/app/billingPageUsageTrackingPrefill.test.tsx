/**
 * @vitest-environment jsdom
 *
 * Route-level coverage for Usage Tracking deep-link prefills. The live smoke
 * run navigated to /msp/billing?tab=usage-tracking&clientId=...&serviceId=...
 * and still saw "All Clients / All Services" because the server page dropped
 * both params from the initialQuery snapshot handed to the dashboard. This
 * test drives the real BillingPage server component with those query params
 * and asserts the snapshot preserves them (the dashboard-side flow from
 * initialQuery to the UsageTracking filters is covered in
 * packages/billing/tests/billingDashboard.usageTrackingPrefill.test.tsx).
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const enforceServerProductRouteMock = vi.fn();
const getServicesMock = vi.fn();
const capturedClientProps: Array<Record<string, unknown>> = [];

vi.mock('@/lib/serverProductRouteGuard', () => ({
  enforceServerProductRoute: enforceServerProductRouteMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: vi.fn().mockResolvedValue({ t: (key: string) => key }),
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServices: getServicesMock,
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getDocumentsByContractId: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('@/app/msp/billing/BillingPageClient', () => ({
  default: (props: Record<string, unknown>) => {
    capturedClientProps.push(props);
    return <div data-testid="billing-page-client" />;
  },
}));

describe('BillingPage usage-tracking deep link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedClientProps.length = 0;
    enforceServerProductRouteMock.mockResolvedValue(null);
    getServicesMock.mockResolvedValue([]);
  });

  it('preserves clientId, serviceId and the period bounds in the initialQuery snapshot', async () => {
    const mod = await import('@/app/msp/billing/page');

    const result = await mod.default({
      searchParams: Promise.resolve({
        tab: 'usage-tracking',
        clientId: 'client-emerald',
        serviceId: 'svc-rabbit-tracking',
        periodStart: '2026-09-01',
        periodEnd: '2026-10-01',
      }),
    });
    render(result as React.ReactElement);

    expect(await screen.findByTestId('billing-page-client')).toBeInTheDocument();
    expect(capturedClientProps).toHaveLength(1);
    expect(capturedClientProps[0].initialQuery).toMatchObject({
      tab: 'usage-tracking',
      clientId: 'client-emerald',
      serviceId: 'svc-rabbit-tracking',
      periodStart: '2026-09-01',
      periodEnd: '2026-10-01',
    });
  });

  it('omits prefill keys when the URL carries none', async () => {
    const mod = await import('@/app/msp/billing/page');

    const result = await mod.default({
      searchParams: Promise.resolve({ tab: 'usage-tracking' }),
    });
    render(result as React.ReactElement);

    expect(await screen.findByTestId('billing-page-client')).toBeInTheDocument();
    const initialQuery = capturedClientProps[0].initialQuery as Record<string, string | undefined>;
    expect(initialQuery.clientId).toBeUndefined();
    expect(initialQuery.serviceId).toBeUndefined();
    expect(initialQuery.periodStart).toBeUndefined();
    expect(initialQuery.periodEnd).toBeUndefined();
  });
});
