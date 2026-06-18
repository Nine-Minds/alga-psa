/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const useSearchParamsMock = vi.hoisted(() => vi.fn());
const getQboConnectionStatusMock = vi.hoisted(() => vi.fn());
const saveQboCredentialsMock = vi.hoisted(() => vi.fn());
const disconnectQboMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock
}));

vi.mock('../../qbo/QboLiveMappingManager', () => ({
  QboLiveMappingManager: ({ defaultConnection }: { defaultConnection: { realmId: string; displayName?: string } }) => (
    <div data-testid="qbo-live-mapping-manager">{defaultConnection.realmId}</div>
  )
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getQboConnectionStatus: async (...args: unknown[]) => getQboConnectionStatusMock(...args),
  saveQboCredentials: async (...args: unknown[]) => saveQboCredentialsMock(...args),
  disconnectQbo: async (...args: unknown[]) => disconnectQboMock(...args)
}));

const disconnectedStatus = {
  connected: false,
  connections: [],
  defaultRealmId: undefined,
  defaultConnection: undefined,
  redirectUri: 'https://example.com/api/integrations/qbo/callback',
  scopes: [
    'com.intuit.quickbooks.accounting',
    'openid',
    'profile',
    'email'
  ],
  environment: 'sandbox' as const,
  credentials: {
    clientIdConfigured: false,
    clientSecretConfigured: false,
    ready: false
  }
};

describe('QboIntegrationSettings contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    getQboConnectionStatusMock.mockResolvedValue(disconnectedStatus);
    saveQboCredentialsMock.mockResolvedValue({ success: true });
    disconnectQboMock.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('T050: displays the redirect URI and QBO OAuth scopes for customer app setup', async () => {
    // Use mockResolvedValue (not Once) to handle repeated calls from the re-rendering component
    getQboConnectionStatusMock.mockResolvedValue(disconnectedStatus);
    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    // Wait for all content to be rendered (all assertions inside waitFor)
    await waitFor(() => {
      expect(screen.getByText('https://example.com/api/integrations/qbo/callback')).toBeInTheDocument();
      expect(screen.getByText('com.intuit.quickbooks.accounting')).toBeInTheDocument();
      expect(screen.getByText('openid')).toBeInTheDocument();
      expect(screen.getByText('profile')).toBeInTheDocument();
      expect(screen.getByText('email')).toBeInTheDocument();
    });
  });

  it('T051: shows Sandbox environment badge when environment is sandbox', async () => {
    getQboConnectionStatusMock.mockResolvedValue(disconnectedStatus);
    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByText('Sandbox')).toBeInTheDocument();
    });
  });

  it('T052: shows Production environment badge when environment is production', async () => {
    getQboConnectionStatusMock.mockResolvedValue({
      ...disconnectedStatus,
      environment: 'production'
    });
    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByText('Production')).toBeInTheDocument();
    });
  });

  it('T053: connect button is disabled when credentials are not ready', async () => {
    getQboConnectionStatusMock.mockResolvedValue(disconnectedStatus);
    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    await waitFor(() => {
      // The Button id prop is used for UI reflection, not the DOM id attribute.
      // Use getByRole to find the button by its accessible name.
      const connectButton = screen.getAllByRole('button', { name: 'Connect QuickBooks' })[0];
      expect(connectButton).toBeInTheDocument();
      expect(connectButton).toBeDisabled();
    });
  });

  it('T054: connect button is enabled when credentials are ready', async () => {
    getQboConnectionStatusMock.mockResolvedValue({
      ...disconnectedStatus,
      credentials: {
        clientIdConfigured: true,
        clientSecretConfigured: true,
        ready: true
      }
    });
    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    await waitFor(() => {
      const connectButton = screen.getAllByRole('button', { name: 'Connect QuickBooks' })[0];
      expect(connectButton).toBeInTheDocument();
      expect(connectButton).not.toBeDisabled();
    });
  });

  it('T055: renders mapping card only when defaultConnection exists, placeholder card otherwise', async () => {
    // First: no default connection — expect placeholder
    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('qbo-integration-mapping-placeholder-card')).toBeInTheDocument();
      expect(document.getElementById('qbo-integration-mapping-card')).not.toBeInTheDocument();
    });

    cleanup();

    // Second: with default connection — expect mapping card
    getQboConnectionStatusMock.mockResolvedValue({
      connected: true,
      connections: [
        { realmId: 'realm-123', displayName: 'Acme Inc', status: 'active' }
      ],
      defaultRealmId: 'realm-123',
      defaultConnection: {
        realmId: 'realm-123',
        displayName: 'Acme Inc',
        status: 'active' as const
      },
      redirectUri: 'https://example.com/api/integrations/qbo/callback',
      scopes: ['com.intuit.quickbooks.accounting'],
      environment: 'sandbox' as const,
      credentials: {
        clientIdConfigured: true,
        clientSecretConfigured: true,
        ready: true
      }
    });

    render(<QboIntegrationSettings />);

    expect(await screen.findByTestId('qbo-live-mapping-manager')).toBeInTheDocument();
    expect(document.getElementById('qbo-integration-mapping-card')).toBeInTheDocument();
    expect(document.getElementById('qbo-integration-mapping-placeholder-card')).not.toBeInTheDocument();
  });

  it('T056: QboLiveMappingManager receives defaultConnection with the connected realmId', async () => {
    getQboConnectionStatusMock.mockResolvedValue({
      connected: true,
      connections: [
        { realmId: 'realm-xyz', displayName: 'Beta Corp', status: 'active' }
      ],
      defaultRealmId: 'realm-xyz',
      defaultConnection: {
        realmId: 'realm-xyz',
        displayName: 'Beta Corp',
        status: 'active' as const
      },
      redirectUri: 'https://example.com/api/integrations/qbo/callback',
      scopes: ['com.intuit.quickbooks.accounting'],
      environment: 'production' as const,
      credentials: {
        clientIdConfigured: true,
        clientSecretConfigured: true,
        ready: true
      }
    });

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    expect(await screen.findByTestId('qbo-live-mapping-manager')).toHaveTextContent('realm-xyz');
    expect(screen.getAllByText('Beta Corp').length).toBeGreaterThan(0);
  });

  it('T057: qbo_status=success shows success alert', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('qbo_status=success'));
    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    expect(await screen.findByText(/QuickBooks connected successfully/)).toBeInTheDocument();
  });

  it('T058: qbo_status=failure + qbo_error=token_exchange_failed shows mapped error alert', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('qbo_status=failure&qbo_error=token_exchange_failed'));
    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    expect(await screen.findByText(/Intuit did not finish the connection/)).toBeInTheDocument();
  });

  it('T059: qbo_status=failure + qbo_error=access_denied shows access denied error', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('qbo_status=failure&qbo_error=access_denied'));
    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    expect(await screen.findByText(/QuickBooks access was denied/)).toBeInTheDocument();
  });

  it('T060: disconnect button is disabled when no company is connected', async () => {
    getQboConnectionStatusMock.mockResolvedValue(disconnectedStatus);
    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    await waitFor(() => {
      // The Button id prop is for UI reflection, not the DOM id attribute.
      const disconnectButton = screen.getAllByRole('button', { name: 'Disconnect QuickBooks' })[0];
      expect(disconnectButton).toBeInTheDocument();
      expect(disconnectButton).toBeDisabled();
    });
  });

  it('T061: disconnect button is enabled when a company is connected', async () => {
    getQboConnectionStatusMock.mockResolvedValue({
      connected: true,
      connections: [
        { realmId: 'realm-123', displayName: 'Acme Inc', status: 'active' }
      ],
      defaultRealmId: 'realm-123',
      defaultConnection: {
        realmId: 'realm-123',
        displayName: 'Acme Inc',
        status: 'active' as const
      },
      redirectUri: 'https://example.com/api/integrations/qbo/callback',
      scopes: ['com.intuit.quickbooks.accounting'],
      environment: 'sandbox' as const,
      credentials: {
        clientIdConfigured: true,
        clientSecretConfigured: true,
        ready: true
      }
    });

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    await waitFor(() => {
      const disconnectButton = screen.getAllByRole('button', { name: 'Disconnect QuickBooks' })[0];
      expect(disconnectButton).toBeInTheDocument();
      expect(disconnectButton).not.toBeDisabled();
    });
  });

  it('T062: does not show the QuickBooks CSV fallback card on the live QuickBooks settings screen', async () => {
    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('qbo-integration-connection-card')).toBeInTheDocument();
    });
    expect(document.getElementById('qbo-integration-manual-alternative-alert')).not.toBeInTheDocument();
    expect(screen.queryByText('QuickBooks CSV remains available')).not.toBeInTheDocument();
  });

  it('T063: syncHealthSlot is rendered when a default connection exists', async () => {
    getQboConnectionStatusMock.mockResolvedValue({
      connected: true,
      connections: [{ realmId: 'realm-1', displayName: 'Acme Books', status: 'active' as const }],
      defaultRealmId: 'realm-1',
      defaultConnection: { realmId: 'realm-1', displayName: 'Acme Books', status: 'active' as const },
      redirectUri: 'https://example.com/api/integrations/qbo/callback',
      scopes: ['com.intuit.quickbooks.accounting'],
      environment: 'sandbox' as const,
      credentials: { clientIdConfigured: true, clientSecretConfigured: true, ready: true },
    });

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings syncHealthSlot={<div data-testid="health-slot" />} />);

    await waitFor(() => {
      expect(screen.getByTestId('health-slot')).toBeInTheDocument();
    });
  });

  it('T064: syncHealthSlot is NOT rendered when no default connection exists', async () => {
    getQboConnectionStatusMock.mockResolvedValue(disconnectedStatus);

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings syncHealthSlot={<div data-testid="health-slot" />} />);

    await waitFor(() => {
      expect(screen.getByText('https://example.com/api/integrations/qbo/callback')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('health-slot')).not.toBeInTheDocument();
  });

  it('T065: onboardingSlot is rendered when a default connection exists', async () => {
    getQboConnectionStatusMock.mockResolvedValue({
      connected: true,
      connections: [{ realmId: 'realm-1', displayName: 'Acme Books', status: 'active' as const }],
      defaultRealmId: 'realm-1',
      defaultConnection: { realmId: 'realm-1', displayName: 'Acme Books', status: 'active' as const },
      redirectUri: 'https://example.com/api/integrations/qbo/callback',
      scopes: ['com.intuit.quickbooks.accounting'],
      environment: 'sandbox' as const,
      credentials: { clientIdConfigured: true, clientSecretConfigured: true, ready: true },
    });

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings onboardingSlot={<div data-testid="onboarding-slot" />} />);

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-slot')).toBeInTheDocument();
    });
  });

  it('T066: onboardingSlot is NOT rendered when no default connection exists', async () => {
    getQboConnectionStatusMock.mockResolvedValue(disconnectedStatus);

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings onboardingSlot={<div data-testid="onboarding-slot" />} />);

    await waitFor(() => {
      expect(screen.getByText('https://example.com/api/integrations/qbo/callback')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('onboarding-slot')).not.toBeInTheDocument();
  });
});
