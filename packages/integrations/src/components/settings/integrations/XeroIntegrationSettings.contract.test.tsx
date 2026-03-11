/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const useSearchParamsMock = vi.hoisted(() => vi.fn());
const getXeroConnectionStatusMock = vi.hoisted(() => vi.fn());
const saveXeroCredentialsMock = vi.hoisted(() => vi.fn());
const disconnectXeroMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock
}));

vi.mock('../../xero/XeroLiveMappingManager', () => ({
  XeroLiveMappingManager: ({ defaultConnection }: { defaultConnection: { connectionId: string } }) => (
    <div data-testid="xero-live-mapping-manager">{defaultConnection.connectionId}</div>
  )
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getXeroConnectionStatus: (...args: unknown[]) => getXeroConnectionStatusMock(...args),
  saveXeroCredentials: (...args: unknown[]) => saveXeroCredentialsMock(...args),
  disconnectXero: (...args: unknown[]) => disconnectXeroMock(...args)
}));

describe('XeroIntegrationSettings contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParamsMock.mockReturnValue(new URLSearchParams('accounting_integration=xero'));
    getXeroConnectionStatusMock.mockResolvedValue({
      connections: [],
      connected: false,
      defaultConnectionId: undefined,
      defaultConnection: undefined,
      redirectUri: 'https://example.com/api/integrations/xero/callback',
      scopes: [
        'offline_access',
        'accounting.settings',
        'accounting.transactions',
        'accounting.contacts'
      ],
      credentials: {
        clientIdConfigured: false,
        clientSecretConfigured: false,
        ready: false
      },
      error: 'Add a Xero client ID and client secret before connecting live Xero.'
    });
    saveXeroCredentialsMock.mockResolvedValue({ success: true });
    disconnectXeroMock.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('T004: displays the redirect URI and Xero OAuth scopes for customer app setup', async () => {
    const { default: XeroIntegrationSettings } = await import('./XeroIntegrationSettings');

    render(<XeroIntegrationSettings />);

    expect(await screen.findByText('https://example.com/api/integrations/xero/callback')).toBeInTheDocument();
    expect(screen.getByText('offline_access')).toBeInTheDocument();
    expect(screen.getByText('accounting.settings')).toBeInTheDocument();
    expect(screen.getByText('accounting.transactions')).toBeInTheDocument();
    expect(screen.getByText('accounting.contacts')).toBeInTheDocument();
  });

  it('T009/T027: keeps Connect disabled and surfaces the missing-credentials error until credentials are configured', async () => {
    const { default: XeroIntegrationSettings } = await import('./XeroIntegrationSettings');

    render(<XeroIntegrationSettings />);

    expect(
      await screen.findByText('Add a Xero client ID and client secret before connecting live Xero.')
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Connect Xero' })[0]).toBeDisabled();
    });
  });

  it('T022: includes guidance that Xero CSV remains available as the manual fallback', async () => {
    const { default: XeroIntegrationSettings } = await import('./XeroIntegrationSettings');

    render(<XeroIntegrationSettings />);

    expect((await screen.findAllByText('Xero CSV remains available')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Billing → Accounting Exports/)).toBeInTheDocument();
  });

  it('T021: renders the live Xero mapping area only when a default connected organisation exists', async () => {
    getXeroConnectionStatusMock.mockResolvedValueOnce({
      connections: [
        {
          connectionId: 'connection-1',
          xeroTenantId: 'xero-tenant-1',
          tenantName: 'Acme Holdings',
          status: 'connected'
        }
      ],
      connected: true,
      defaultConnectionId: 'connection-1',
      defaultConnection: {
        connectionId: 'connection-1',
        xeroTenantId: 'xero-tenant-1',
        tenantName: 'Acme Holdings',
        status: 'connected'
      },
      redirectUri: 'https://example.com/api/integrations/xero/callback',
      scopes: [
        'offline_access',
        'accounting.settings',
        'accounting.transactions',
        'accounting.contacts'
      ],
      credentials: {
        clientIdConfigured: true,
        clientSecretConfigured: true,
        ready: true
      }
    });

    const { default: XeroIntegrationSettings } = await import('./XeroIntegrationSettings');

    render(<XeroIntegrationSettings />);

    expect(await screen.findByTestId('xero-live-mapping-manager')).toHaveTextContent('connection-1');
    expect(screen.getByText('Live Xero Mapping & Configuration')).toBeInTheDocument();

    cleanup();

    getXeroConnectionStatusMock.mockResolvedValueOnce({
      connections: [],
      connected: false,
      defaultConnectionId: undefined,
      defaultConnection: undefined,
      redirectUri: 'https://example.com/api/integrations/xero/callback',
      scopes: [
        'offline_access',
        'accounting.settings',
        'accounting.transactions',
        'accounting.contacts'
      ],
      credentials: {
        clientIdConfigured: true,
        clientSecretConfigured: true,
        ready: true
      }
    });

    render(<XeroIntegrationSettings />);

    await waitFor(() => {
      expect(screen.queryByTestId('xero-live-mapping-manager')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Connect a live Xero organisation before configuring live Xero item and tax mappings/)).toBeInTheDocument();
  });

  it('T026: uses the first default Xero connection for the mapping context without rendering an org picker', async () => {
    getXeroConnectionStatusMock.mockResolvedValueOnce({
      connections: [
        {
          connectionId: 'connection-1',
          xeroTenantId: 'xero-tenant-1',
          tenantName: 'Acme Holdings',
          status: 'connected'
        },
        {
          connectionId: 'connection-2',
          xeroTenantId: 'xero-tenant-2',
          tenantName: 'Backup Org',
          status: 'connected'
        }
      ],
      connected: true,
      defaultConnectionId: 'connection-1',
      defaultConnection: {
        connectionId: 'connection-1',
        xeroTenantId: 'xero-tenant-1',
        tenantName: 'Acme Holdings',
        status: 'connected'
      },
      redirectUri: 'https://example.com/api/integrations/xero/callback',
      scopes: [
        'offline_access',
        'accounting.settings',
        'accounting.transactions',
        'accounting.contacts'
      ],
      credentials: {
        clientIdConfigured: true,
        clientSecretConfigured: true,
        ready: true
      }
    });

    const { default: XeroIntegrationSettings } = await import('./XeroIntegrationSettings');

    render(<XeroIntegrationSettings />);

    expect(await screen.findByTestId('xero-live-mapping-manager')).toHaveTextContent('connection-1');
    expect(screen.getAllByText('Acme Holdings').length).toBeGreaterThan(0);
    expect(screen.queryByText('Select organisation')).not.toBeInTheDocument();
  });

  it('T028: surfaces the expired default-connection error state when the stored Xero connection cannot authenticate', async () => {
    getXeroConnectionStatusMock.mockResolvedValueOnce({
      connections: [
        {
          connectionId: 'connection-1',
          xeroTenantId: 'xero-tenant-1',
          tenantName: 'Acme Holdings',
          status: 'expired'
        }
      ],
      connected: false,
      defaultConnectionId: 'connection-1',
      defaultConnection: {
        connectionId: 'connection-1',
        xeroTenantId: 'xero-tenant-1',
        tenantName: 'Acme Holdings',
        status: 'expired'
      },
      redirectUri: 'https://example.com/api/integrations/xero/callback',
      scopes: [
        'offline_access',
        'accounting.settings',
        'accounting.transactions',
        'accounting.contacts'
      ],
      credentials: {
        clientIdConfigured: true,
        clientSecretConfigured: true,
        ready: true
      },
      error: 'Your default Xero connection has expired. Disconnect and reconnect Xero to continue.'
    });

    const { default: XeroIntegrationSettings } = await import('./XeroIntegrationSettings');

    render(<XeroIntegrationSettings />);

    expect(
      await screen.findByText('Your default Xero connection has expired. Disconnect and reconnect Xero to continue.')
    ).toBeInTheDocument();
    expect(screen.getAllByText('Connection Expired').length).toBeGreaterThan(0);
  });
});
