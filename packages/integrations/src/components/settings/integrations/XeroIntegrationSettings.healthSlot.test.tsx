/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const useSearchParamsMock = vi.hoisted(() => vi.fn());
const getXeroConnectionStatusMock = vi.hoisted(() => vi.fn());
const useAccountingCapabilitiesMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useSearchParams: useSearchParamsMock }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>
}));
vi.mock('../../xero/XeroLiveMappingManager', () => ({
  XeroLiveMappingManager: () => <div data-testid="xero-mapping-manager" />
}));
vi.mock('../../../actions/integrations/xeroActions', () => ({
  getXeroConnectionStatus: (...args: unknown[]) => getXeroConnectionStatusMock(...args),
  saveXeroCredentials: vi.fn(async () => ({ success: true })),
  disconnectXero: vi.fn(async () => ({ success: true })),
  forceFinalizeXeroDisconnect: vi.fn(async () => ({ success: true }))
}));
vi.mock('./useAccountingCapabilities', () => ({
  useAccountingCapabilities: useAccountingCapabilitiesMock
}));

// The health slot composition is the subject here; the provider-aware English
// resources are asserted by billing's accountingSyncTranslations.test.ts.
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, any> = {}) => options.defaultValue ?? key
  })
}));

const fullCaps = {
  catalogRead: true,
  connectionsManage: true,
  mappingsManage: true,
  exportsExecute: true,
  remoteMutate: true,
  hasAny: true,
  loaded: true
};

describe('XeroIntegrationSettings health slot + real locale resources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    useAccountingCapabilitiesMock.mockReturnValue(fullCaps);
    getXeroConnectionStatusMock.mockResolvedValue({
      connected: true,
      connections: [{ connectionId: 'conn-1', xeroTenantId: 'tenant-1', status: 'connected' }],
      defaultConnection: {
        connectionId: 'conn-1',
        xeroTenantId: 'tenant-1',
        tenantName: 'Acme Org',
        status: 'connected'
      },
      credentials: { ready: true, clientIdConfigured: true, clientSecretConfigured: true },
      redirectUri: 'https://example.com/api/integrations/xero/callback',
      scopes: ['accounting.transactions'],
      scopeSource: 'default',
      scopeOverrideInvalid: [],
      disconnect: undefined,
      error: null
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('mounts the provider health slot for a connected Xero organisation and uses locale copy', async () => {
    const { default: XeroIntegrationSettings } = await import('./XeroIntegrationSettings');

    render(
      <XeroIntegrationSettings syncHealthSlot={<div id="xero-sync-health">Xero Sync Health</div>} />
    );

    await waitFor(() => {
      expect(document.getElementById('xero-sync-health')).toBeInTheDocument();
    });
    // Real en resource string (not a QuickBooks label).
    expect(screen.getByText(/Live Xero Mapping & Configuration/)).toBeInTheDocument();
  });
});
