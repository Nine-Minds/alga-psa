/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LicenseBanner from '@/components/licenses/LicenseBanner';
import { getLicenseStatus } from '@/lib/actions/licenseManagementActions';
import type { LicenseStatus } from '@/lib/actions/licenseManagementActions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/actions/licenseManagementActions', () => ({
  getLicenseStatus: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const template = String(options?.defaultValue ?? key);
      return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, token) =>
        String(options?.[token] ?? '')
      );
    },
  }),
}));

const mockGetLicenseStatus = vi.mocked(getLicenseStatus);

const baseStatus: LicenseStatus = {
  selfHostMode: true,
  state: 'trial_available',
  tier: 'essentials',
  expiresAt: null,
  daysRemaining: null,
  customer: null,
  trialUsed: false,
  connected: false,
  lastCheckinAt: null,
  tenantId: 'tenant-1',
  subscription: null,
};

const scenarios: Array<{
  name: string;
  status: LicenseStatus;
  expectedMessage: string | RegExp;
}> = [
  {
    name: 'active trial',
    status: {
      ...baseStatus,
      state: 'trial',
      tier: 'pro',
      daysRemaining: 12,
      trialUsed: true,
    },
    expectedMessage: 'Pro trial active — 12 days remaining.',
  },
  {
    name: 'expiring trial',
    status: {
      ...baseStatus,
      state: 'trial',
      tier: 'pro',
      daysRemaining: 3,
      trialUsed: true,
    },
    expectedMessage: 'Pro trial expires in 3 days. Enter a license key to keep Pro features.',
  },
  {
    name: 'available trial',
    status: baseStatus,
    expectedMessage: 'Running Essentials features. Start a free 15-day Pro trial to unlock all features.',
  },
  {
    name: 'expired trial',
    status: {
      ...baseStatus,
      state: 'trial_expired',
      trialUsed: true,
    },
    expectedMessage: 'Pro trial has expired. The install is now running Essentials features.',
  },
  {
    name: 'unused CE trial',
    status: {
      ...baseStatus,
      state: 'ce',
    },
    expectedMessage: 'Running Essentials features. Start a free 15-day Pro trial to unlock all features.',
  },
  {
    name: 'cancelled subscription still running Pro',
    status: {
      ...baseStatus,
      state: 'licensed',
      tier: 'pro',
      daysRemaining: 25,
      trialUsed: true,
      subscription: { phase: 'ending', endsAt: '2030-01-31T12:00:00.000Z', resubscribeUrl: null },
    },
    expectedMessage: /^Your Pro subscription has been cancelled\. Pro ends on .*2030.*\. Resubscribe to keep Pro\.$/,
  },
  {
    name: 'cancelled subscription with an unknown end date',
    status: {
      ...baseStatus,
      state: 'licensed',
      tier: 'pro',
      daysRemaining: 25,
      subscription: { phase: 'ending', endsAt: null, resubscribeUrl: null },
    },
    expectedMessage: 'Your Pro subscription has been cancelled. Resubscribe to keep Pro.',
  },
  {
    name: 'lapsed subscription',
    status: {
      ...baseStatus,
      state: 'license_expired',
      trialUsed: true,
      subscription: { phase: 'lapsed', endsAt: '2025-07-12T00:00:00.000Z', resubscribeUrl: null },
    },
    expectedMessage: "You're now on the free edition. Resubscribe to restore Pro.",
  },
];

describe('LicenseBanner', () => {
  beforeEach(() => {
    mockGetLicenseStatus.mockResolvedValue(baseStatus);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each(scenarios)('names the $name as Pro', async ({ status, expectedMessage }) => {
    mockGetLicenseStatus.mockResolvedValue(status);

    render(<LicenseBanner />);

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(screen.queryByText(/(?:Enterprise|Premium)/i)).not.toBeInTheDocument();
  });

  it('shows a Resubscribe link only when the server supplied a URL', async () => {
    const ending: LicenseStatus = {
      ...baseStatus,
      state: 'licensed',
      tier: 'pro',
      daysRemaining: 25,
      subscription: { phase: 'ending', endsAt: '2030-01-31T12:00:00.000Z', resubscribeUrl: 'https://portal.example/r' },
    };
    mockGetLicenseStatus.mockResolvedValue(ending);
    const { unmount } = render(<LicenseBanner />);
    expect((await screen.findByRole('link', { name: 'Resubscribe' })).getAttribute('href')).toBe('https://portal.example/r');
    unmount();

    mockGetLicenseStatus.mockResolvedValue({ ...ending, subscription: { ...ending.subscription!, resubscribeUrl: null } });
    render(<LicenseBanner />);
    await screen.findByText(/Your Pro subscription has been cancelled/);
    expect(screen.queryByRole('link', { name: 'Resubscribe' })).not.toBeInTheDocument();
  });

  it('keeps the generic expiry wording when there is no subscription context', async () => {
    mockGetLicenseStatus.mockResolvedValue({ ...baseStatus, state: 'license_expired', trialUsed: true });
    render(<LicenseBanner />);
    expect(await screen.findByText('License has expired. The install is now running Essentials features.')).toBeInTheDocument();
  });

  it('is hidden when the subscription is healthy and far from expiry', async () => {
    mockGetLicenseStatus.mockResolvedValue({ ...baseStatus, state: 'licensed', tier: 'pro', daysRemaining: 25 });
    const { container } = render(<LicenseBanner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
