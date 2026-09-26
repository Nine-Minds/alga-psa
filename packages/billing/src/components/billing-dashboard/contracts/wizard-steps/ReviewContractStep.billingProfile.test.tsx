// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The basics step lets an operator send a contract to a merged-in billing
 * profile; the review step is the last screen before the contract is created,
 * so it has to say where the contract will bill — and stay silent for the
 * single-profile client the feature is invisible to.
 */

const mocks = vi.hoisted(() => ({
  getClientByIdForBilling: vi.fn(),
  loadProfiles: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getClientByIdForBilling: mocks.getClientByIdForBilling,
}));
vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({
  getClientBillingProfilesForBilling: mocks.loadProfiles,
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
  useFormatBillingFrequency: () => (value: string) => value,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const fallback = (options?.defaultValue as string) ?? key;
      return fallback.replace(/{{(\w+)}}/g, (_match, token) => String(options?.[token] ?? ''));
    },
  }),
  useFormatters: () => ({
    formatCurrency: (value: number) => `$${value.toFixed(2)}`,
    formatNumber: (value: number) => String(value),
    formatDate: (value: Date) => value.toISOString().slice(0, 10),
  }),
}));

const { ReviewContractStep } = await import('./ReviewContractStep');

const profile = (id: string, name: string, isDefault: boolean) => ({
  billing_profile_id: id,
  client_id: 'client-1',
  name,
  is_default: isDefault,
  is_active: true,
  is_system_managed_default: isDefault,
});

const wizardData = (billingProfileId: string | null) => ({
  client_id: 'client-1',
  contract_name: 'Emerald City Support',
  billing_frequency: 'monthly',
  currency_code: 'USD',
  start_date: '2026-01-01',
  billing_profile_id: billingProfileId,
  fixed_services: [],
  product_services: [],
  hourly_services: [],
  usage_services: [],
}) as any;

describe('ReviewContractStep billing profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientByIdForBilling.mockResolvedValue({ client_name: 'Emerald City Dental' });
  });

  afterEach(() => {
    cleanup();
  });

  it('names the profile a segmented client will bill to', async () => {
    mocks.loadProfiles.mockResolvedValue([
      profile('profile-default', 'Emerald City Dental', true),
      profile('profile-merged', 'Munchkinland Clinic', false),
    ]);

    render(<ReviewContractStep data={wizardData('profile-merged')} />);

    await waitFor(() => {
      expect(screen.getByText('Billing Profile')).toBeTruthy();
    });
    expect(screen.getByText('Munchkinland Clinic')).toBeTruthy();
  });

  it('falls back to the client default when no profile was picked', async () => {
    mocks.loadProfiles.mockResolvedValue([
      profile('profile-default', 'Emerald City Dental', true),
      profile('profile-merged', 'Munchkinland Clinic', false),
    ]);

    render(<ReviewContractStep data={wizardData(null)} />);

    await waitFor(() => {
      expect(screen.getByText("The client's default profile")).toBeTruthy();
    });
  });

  it('shows no profile row for a single-profile client', async () => {
    mocks.loadProfiles.mockResolvedValue([profile('profile-default', 'Emerald City Dental', true)]);

    render(<ReviewContractStep data={wizardData(null)} />);

    await waitFor(() => {
      expect(mocks.loadProfiles).toHaveBeenCalledWith('client-1');
    });
    expect(screen.queryByText('Billing Profile')).toBeNull();
  });
});
