// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import englishSettings from '../../../public/locales/en/msp/settings.json';
import expandedSettings from '../../../public/locales/yy/msp/settings.json';
import { pseudoString } from '../../../../tools/i18n/lib/pseudo-locale.mjs';

let settings = englishSettings;

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
    t: (key: string) => key.split('.').reduce<unknown>((value, part) =>
      value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined,
    settings) ?? key,
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
  settings = englishSettings;
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

  it('shows the proxy certificate note in direct mode, including CE', async () => {
    getStatus.mockResolvedValue(status('direct', 'ce'));
    render(<ClientPortalDomainSettings />);

    expect(await screen.findByText(/Configure a branded hostname.*TLS terminates at your reverse proxy, which holds the certificate\./)).toBeTruthy();
    expect(screen.queryByText(/We will provision TLS certificates automatically/)).toBeNull();
  });

  it('renders the generated expanded-locale proxy note in direct mode', async () => {
    settings = expandedSettings;
    getStatus.mockResolvedValue(status('direct', 'ce'));
    render(<ClientPortalDomainSettings />);

    const domain = englishSettings.clientPortal.domain;
    const expected = `${pseudoString(domain.description, 'yy')} ${pseudoString(domain.appliance.tlsNote, 'yy')}`;
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(screen.queryByText(pseudoString(domain.hostedTlsNote, 'yy'), { exact: false })).toBeNull();
  });

  it('shows only neutral copy when the loaded mode is unrecognized', async () => {
    getStatus.mockResolvedValue({ ...status('direct'), mode: 'unknown' });
    render(<ClientPortalDomainSettings />);

    expect(await screen.findByText('Configure a branded hostname for your client portal.')).toBeTruthy();
    expect(screen.queryByText(/TLS certificates automatically/)).toBeNull();
    expect(screen.queryByText(/TLS terminates at your reverse proxy/)).toBeNull();
  });
});
