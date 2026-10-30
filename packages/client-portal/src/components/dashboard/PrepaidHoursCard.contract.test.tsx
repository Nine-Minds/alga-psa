/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrepaidHoursCard } from './PrepaidHoursCard';

const checkClientPortalPermissionsMock = vi.hoisted(() => vi.fn());
const getClientBucketUsageMock = vi.hoisted(() => vi.fn());
const getClientHourBlocksMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ locale: 'en' }),
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

describe('PrepaidHoursCard dashboard widget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkClientPortalPermissionsMock.mockResolvedValue({ hasBillingAccess: true });
    getClientBucketUsageMock.mockResolvedValue([bucketRow()]);
    getClientHourBlocksMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('T164: renders nothing without billing access', async () => {
    checkClientPortalPermissionsMock.mockResolvedValue({ hasBillingAccess: false });
    const { container } = render(<PrepaidHoursCard />);
    await vi.waitFor(() => expect(checkClientPortalPermissionsMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(getClientBucketUsageMock).not.toHaveBeenCalled();
  });

  it('T165: renders nothing when the bucket action returns a permission error', async () => {
    getClientBucketUsageMock.mockResolvedValue({ permissionError: 'Unauthorized' });
    const { container } = render(<PrepaidHoursCard />);
    await vi.waitFor(() => expect(getClientBucketUsageMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('T166: renders nothing when there are no bucket lines', async () => {
    getClientBucketUsageMock.mockResolvedValue([]);
    const { container } = render(<PrepaidHoursCard />);
    await vi.waitFor(() => expect(getClientBucketUsageMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('T167: renders the card with a per-line meter and a View billing link when all gates pass', async () => {
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
    getClientBucketUsageMock.mockResolvedValue([
      bucketRow({ minutes_used: 1500, percentage_used: 113.64, remaining_minutes: -180 }),
    ]);
    render(<PrepaidHoursCard />);

    expect(await screen.findByText('3.0h OVER')).toBeInTheDocument();
    expect(screen.queryByText(/-3\.0h/i)).not.toBeInTheDocument();
  });

  it('renders a "Contract: <name>" label for contract-issued hour blocks only', async () => {
    getClientBucketUsageMock.mockResolvedValue([]);
    const block = {
      service_id: 's', service_name: 'Support', total_minutes: 600, remaining_minutes: 300,
      hours_total: 10, hours_remaining: 5, expiration_date: null, status: 'active',
    };
    getClientHourBlocksMock.mockResolvedValue([
      { ...block, block_id: 'cb-1', contract_name: 'Acme MSP' },
      { ...block, block_id: 'ab-1', contract_name: null },
    ]);
    render(<PrepaidHoursCard />);

    expect(await screen.findByText('Contract: Acme MSP')).toBeInTheDocument();
    expect(document.getElementById('prepaid-hour-block-contract-cb-1')).not.toBeNull();
    expect(document.getElementById('prepaid-hour-block-contract-ab-1')).toBeNull();
  });

  it('shows the remaining value of a rated block in its currency and omits it for an unrated one', async () => {
    getClientBucketUsageMock.mockResolvedValue([]);
    const block = {
      service_id: 's', service_name: 'Support', total_minutes: 600, remaining_minutes: 300,
      hours_total: 10, hours_remaining: 5, expiration_date: null, status: 'active', contract_name: null,
    };
    getClientHourBlocksMock.mockResolvedValue([
      { ...block, block_id: 'rated', currency_code: 'EUR', remaining_value: 55000, valid_from: null },
      { ...block, block_id: 'unrated', currency_code: null, remaining_value: 0, valid_from: null },
    ]);
    render(<PrepaidHoursCard />);

    expect(await screen.findByText('5.0h left · €550.00')).toBeInTheDocument();
    expect(document.getElementById('prepaid-hour-block-remaining-rated')).not.toBeNull();
    expect(document.getElementById('prepaid-hour-block-remaining-unrated')).toBeNull();
  });
});
