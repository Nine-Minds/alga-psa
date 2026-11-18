// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import settings from '../../../public/locales/en/msp/settings.json';

const { getStatus, confirmUris } = vi.hoisted(() => ({ getStatus: vi.fn(), confirmUris: vi.fn() }));

vi.mock('@/lib/actions/tenant-actions/portalDomainActions', () => ({
  getPortalDomainStatusAction: getStatus,
  confirmPortalDomainRedirectUrisAction: confirmUris,
  disablePortalDomainAction: vi.fn(),
  refreshPortalDomainStatusAction: vi.fn(),
  requestPortalDomainRegistrationAction: vi.fn(),
  retryPortalDomainRegistrationAction: vi.fn(),
}));

// Stable `t` identity: the component refetches whenever `t` changes.
const { t } = vi.hoisted(() => ({
  t: (key: string, opts?: Record<string, string>) => {
    const value = key.split('.').reduce<unknown>(
      (v, part) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined),
      (globalThis as any).__settings
    );
    return typeof value === 'string'
      ? value.replace(/\{\{(\w+)\}\}/g, (_m, k) => opts?.[k] ?? '')
      : key;
  },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t }),
}));

import ClientPortalDomainSettings from '@/components/settings/general/ClientPortalDomainSettings';

(globalThis as any).__settings = settings;

const URI = 'https://msp.example.com/api/auth/callback/google';
const pending = (canSelfConfirm: boolean) => ({
  domain: 'msp.example.com',
  canonicalHost: 'portal.example.com',
  surface: 'msp' as const,
  status: 'pending_redirect_uri' as const,
  statusMessage: 'Waiting for redirect URIs',
  lastCheckedAt: null,
  verificationMethod: 'cname' as const,
  verificationDetails: {},
  certificateSecretName: null,
  lastSyncedResourceVersion: null,
  createdAt: null,
  updatedAt: null,
  isEditable: true,
  edition: 'ce' as const,
  mode: 'direct' as const,
  ssoRedirectUris: { required: [URI], confirmed: [], missing: [URI], source: null, canSelfConfirm },
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('custom domain pending_redirect_uri state', () => {
  it('lists missing URIs and confirms them when the admin can self-confirm', async () => {
    getStatus.mockResolvedValue(pending(true));
    confirmUris.mockResolvedValue({ ...pending(true), status: 'active', ssoRedirectUris: undefined });
    render(<ClientPortalDomainSettings />);

    await waitFor(() => expect(screen.getByText(URI)).toBeTruthy());
    expect(screen.getByText('Pending Redirect URIs')).toBeTruthy();
    expect(screen.getByText('Serves: MSP app')).toBeTruthy();

    fireEvent.click(screen.getByText("I've registered these — confirm"));
    await waitFor(() => expect(confirmUris).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(URI)).toBeNull());
  });

  it('tells the user to contact an administrator when they cannot self-confirm', async () => {
    getStatus.mockResolvedValue(pending(false));
    render(<ClientPortalDomainSettings />);

    await waitFor(() => expect(screen.getByText(URI)).toBeTruthy());
    expect(screen.queryByText("I've registered these — confirm")).toBeNull();
    expect(screen.getByText(/contact support to register and confirm/)).toBeTruthy();
  });
});
