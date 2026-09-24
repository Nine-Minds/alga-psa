// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getStatus } = vi.hoisted(() => ({ getStatus: vi.fn() }));

vi.mock('@/lib/actions/tenant-actions/portalDomainActions', () => ({
  getPortalDomainStatusAction: getStatus,
  disablePortalDomainAction: vi.fn(),
  refreshPortalDomainStatusAction: vi.fn(),
  requestPortalDomainRegistrationAction: vi.fn(),
  retryPortalDomainRegistrationAction: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'clientPortal.domain.title': 'Custom Domain',
      'clientPortal.domain.description': 'Configure a branded hostname for your client portal.',
      'clientPortal.domain.hostedTlsNote': 'We will provision TLS certificates automatically once DNS is verified.',
      'clientPortal.domain.appliance.tlsNote': 'TLS terminates at your reverse proxy. Obtain and maintain the TLS certificate for the domain on your proxy.',
    }[key] ?? key),
  }),
}));

import ClientPortalDomainSettings from '@/components/settings/general/ClientPortalDomainSettings';

const status = (mode: 'temporal' | 'direct', edition: 'ce' | 'ee' = mode === 'direct' ? 'ce' : 'ee') => ({
  domain: null,
  canonicalHost: 'portal.example.com',
  status: 'disabled' as const,
  statusMessage: null,
  lastCheckedAt: null,
  verificationMethod: 'cname' as const,
  verificationDetails: {},
  certificateSecretName: null,
  lastSyncedResourceVersion: null,
  createdAt: null,
  updatedAt: null,
  isEditable: true,
  edition,
  mode,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('client portal custom domain header TLS note', () => {
  it('shows only neutral copy while loading and after the status request fails', async () => {
    let rejectStatus!: (reason: Error) => void;
    getStatus.mockReturnValue(new Promise((_resolve, reject) => { rejectStatus = reject; }));
    const view = render(<ClientPortalDomainSettings />);

    expect(screen.getByText('Configure a branded hostname for your client portal.')).toBeTruthy();
    expect(screen.queryByText(/TLS certificates automatically/)).toBeNull();
    rejectStatus(new Error('status unavailable'));
    await waitFor(() => expect(screen.getByText('Configure a branded hostname for your client portal.')).toBeTruthy());
    expect(screen.queryByText(/TLS certificates automatically/)).toBeNull();
    expect(screen.queryByText(/TLS terminates at your reverse proxy/)).toBeNull();
    view.unmount();
  });

  it('shows the hosted auto-provision note after hosted status loads', async () => {
    getStatus.mockResolvedValue(status('temporal'));
    render(<ClientPortalDomainSettings />);

    expect(await screen.findByText(/Configure a branded hostname.*We will provision TLS certificates automatically once DNS is verified\./)).toBeTruthy();
  });

  it('shows the proxy certificate note in direct mode, including the CE omitted-mode status', async () => {
    getStatus.mockResolvedValue({ ...status('direct'), mode: undefined });
    render(<ClientPortalDomainSettings />);

    expect(await screen.findByText(/Configure a branded hostname.*TLS terminates at your reverse proxy\. Obtain and maintain/)).toBeTruthy();
    expect(screen.queryByText(/We will provision TLS certificates automatically/)).toBeNull();
  });
});
