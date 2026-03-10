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
});
