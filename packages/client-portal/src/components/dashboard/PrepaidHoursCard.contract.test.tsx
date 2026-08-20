/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrepaidHoursCard } from './PrepaidHoursCard';

const featureFlagState = vi.hoisted(() => ({
  enabled: false,
  loading: false,
  error: null as Error | null,
}));

const checkClientPortalPermissionsMock = vi.hoisted(() => vi.fn());
const getClientBucketUsageMock = vi.hoisted(() => vi.fn());
const getClientHourBlocksMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => featureFlagState,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
      if (!fallback) return key;
      if (typeof fallback === 'string') return fallback;
      const base = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : key;
      return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name] ?? ''));
    },
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@alga-psa/client-portal/actions', () => ({
  checkClientPortalPermissions: (...args: unknown[]) => checkClientPortalPermissionsMock(...args),
  getClientBucketUsage: (...args: unknown[]) => getClientBucketUsageMock(...args),
  getClientHourBlocks: (...args: unknown[]) => getClientHourBlocksMock(...args),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <h3 {...props}>{children}</h3>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

function bucketRow(overrides: Record<string, unknown> = {}) {
  return {
    contract_line_id: 'line-1',
    contract_line_name: 'Managed Support',
    service_id: 'service-1',
    service_name: 'Help Desk',
    display_label: 'Managed Support - Help Desk',
    total_minutes: 1200,
    minutes_used: 900,
    rolled_over_minutes: 120,
    remaining_minutes: 420,
    period_start: '2026-01-01',
    period_end: '2026-02-01',
    percentage_used: 68.18,
    percentage_remaining: 31.82,
    hours_total: 22,
    hours_used: 15,
    hours_remaining: 7,
    ...overrides,
  };
}

describe('PrepaidHoursCard dashboard widget (release-v1-5-feature)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagState.enabled = false;
    featureFlagState.loading = false;
    featureFlagState.error = null;
    checkClientPortalPermissionsMock.mockResolvedValue({ hasBillingAccess: true });
    getClientBucketUsageMock.mockResolvedValue([bucketRow()]);
    getClientHourBlocksMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('T163: renders nothing when the flag is off', () => {
    const { container } = render(<PrepaidHoursCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('T164: renders nothing without billing access', async () => {
    featureFlagState.enabled = true;
    checkClientPortalPermissionsMock.mockResolvedValue({ hasBillingAccess: false });
    const { container } = render(<PrepaidHoursCard />);
    await vi.waitFor(() => expect(checkClientPortalPermissionsMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(getClientBucketUsageMock).not.toHaveBeenCalled();
  });

  it('T165: renders nothing when the bucket action returns a permission error', async () => {
    featureFlagState.enabled = true;
    getClientBucketUsageMock.mockResolvedValue({ permissionError: 'Unauthorized' });
    const { container } = render(<PrepaidHoursCard />);
    await vi.waitFor(() => expect(getClientBucketUsageMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('T166: renders nothing when there are no bucket lines', async () => {
    featureFlagState.enabled = true;
    getClientBucketUsageMock.mockResolvedValue([]);
    const { container } = render(<PrepaidHoursCard />);
    await vi.waitFor(() => expect(getClientBucketUsageMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('T167: renders the card with a per-line meter and a View billing link when all gates pass', async () => {
    featureFlagState.enabled = true;
    render(<PrepaidHoursCard />);

    expect(await screen.findByText('Prepaid hours')).toBeInTheDocument();
    expect(screen.getByText('View billing')).toBeInTheDocument();
    expect(screen.getByText('Managed Support - Help Desk')).toBeInTheDocument();
    expect(screen.getByText('7.0h left')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view billing/i })).toHaveAttribute(
      'href',
      '/client-portal/billing'
    );
  });

  it('T168: overage rows render a red OVER badge instead of a negative number', async () => {
    featureFlagState.enabled = true;
    getClientBucketUsageMock.mockResolvedValue([
      bucketRow({ minutes_used: 1500, percentage_used: 113.64, remaining_minutes: -180 }),
    ]);
    render(<PrepaidHoursCard />);

    expect(await screen.findByText('3.0h OVER')).toBeInTheDocument();
    expect(screen.queryByText(/-3\.0h/i)).not.toBeInTheDocument();
  });
});
