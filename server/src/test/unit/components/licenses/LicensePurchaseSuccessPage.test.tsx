// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LicensePurchaseSuccessPage from '@/app/msp/licenses/purchase/success/page';
import { getLicenseUsageAction } from '@/lib/actions/licensingActions';

vi.mock('@/lib/actions/licensingActions', () => ({ getLicenseUsageAction: vi.fn() }));
vi.mock('@enterprise/lib/actions/license-actions', () => ({ getSubscriptionInfoAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
  useFormatters: () => ({ formatDate: (value: string) => value }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getLicenseUsageAction).mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function finishLoading() {
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
}

describe('purchase-success license display', () => {
  it('shows the license limit returned by the authenticated action', async () => {
    vi.mocked(getLicenseUsageAction).mockResolvedValue({
      success: true, data: { limit: 12, used: 4, remaining: 8 },
    });
    render(<LicensePurchaseSuccessPage />);
    expect(screen.getByText('Updating license count...')).toBeInTheDocument();
    await finishLoading();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('total licenses')).toBeInTheDocument();
    expect(screen.queryByText('Unlimited')).not.toBeInTheDocument();
    expect(getLicenseUsageAction).toHaveBeenCalledWith();
  });

  it('shows an unlimited limit only after a successful response', async () => {
    vi.mocked(getLicenseUsageAction).mockResolvedValue({
      success: true, data: { limit: null, used: 69, remaining: null },
    });
    render(<LicensePurchaseSuccessPage />);
    expect(screen.queryByText('Unlimited')).not.toBeInTheDocument();
    await finishLoading();
    expect(screen.getByText('Unlimited')).toBeInTheDocument();
    expect(screen.queryByText('total licenses')).not.toBeInTheDocument();
  });

  it('does not display an unlimited license claim when the action fails', async () => {
    vi.mocked(getLicenseUsageAction).mockResolvedValue({ success: false, error: 'Failed to get license usage' });
    render(<LicensePurchaseSuccessPage />);
    await finishLoading();
    expect(screen.queryByText('Unlimited')).not.toBeInTheDocument();
    expect(screen.queryByText('You now have')).not.toBeInTheDocument();
  });
});
