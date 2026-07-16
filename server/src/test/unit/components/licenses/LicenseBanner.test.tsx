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
};

const scenarios: Array<{
  name: string;
  status: LicenseStatus;
  expectedMessage: string;
}> = [
  {
    name: 'active trial',
    status: {
      ...baseStatus,
      state: 'trial',
      tier: 'premium',
      daysRemaining: 12,
      trialUsed: true,
    },
    expectedMessage: 'Premium trial active — 12 days remaining.',
  },
  {
    name: 'expiring trial',
    status: {
      ...baseStatus,
      state: 'trial',
      tier: 'premium',
      daysRemaining: 3,
      trialUsed: true,
    },
    expectedMessage: 'Premium trial expires in 3 days. Enter a license key to keep Premium features.',
  },
  {
    name: 'available trial',
    status: baseStatus,
    expectedMessage: 'Running Essentials features. Start a free 15-day Premium trial to unlock all features.',
  },
  {
    name: 'expired trial',
    status: {
      ...baseStatus,
      state: 'trial_expired',
      trialUsed: true,
    },
    expectedMessage: 'Premium trial has expired. The install is now running Essentials features.',
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

  it.each(scenarios)('names the $name as Premium', async ({ status, expectedMessage }) => {
    mockGetLicenseStatus.mockResolvedValue(status);

    render(<LicenseBanner />);

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(screen.queryByText(/Enterprise trial/i)).not.toBeInTheDocument();
  });
});
