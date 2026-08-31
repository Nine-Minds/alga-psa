/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

const useSearchParamsMock = vi.hoisted(() => vi.fn());
const getQboConnectionStatusMock = vi.hoisted(() => vi.fn());
const saveQboCredentialsMock = vi.hoisted(() => vi.fn());
const disconnectQboMock = vi.hoisted(() => vi.fn());
const getQboAutomatedSalesTaxModeMock = vi.hoisted(() => vi.fn());
const setQboAutomatedSalesTaxModeMock = vi.hoisted(() => vi.fn());

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
  disconnectQbo: async (...args: unknown[]) => disconnectQboMock(...args),
  getQboAutomatedSalesTaxMode: async (...args: unknown[]) => getQboAutomatedSalesTaxModeMock(...args),
  setQboAutomatedSalesTaxMode: async (...args: unknown[]) => setQboAutomatedSalesTaxModeMock(...args)
}));

vi.mock('../../../actions/qboActions', () => ({
  getQboConnectionStatus: async (...args: unknown[]) => getQboConnectionStatusMock(...args),
  saveQboCredentials: async (...args: unknown[]) => saveQboCredentialsMock(...args),
  disconnectQbo: async (...args: unknown[]) => disconnectQboMock(...args),
  getQboAutomatedSalesTaxMode: async (...args: unknown[]) => getQboAutomatedSalesTaxModeMock(...args),
  setQboAutomatedSalesTaxMode: async (...args: unknown[]) => setQboAutomatedSalesTaxModeMock(...args),
}));

// The accounting-capability hook is exercised per-test through this mutable
// state holder; default to a fully-capable user so the panels render their
// content (an unauthenticated test session would otherwise show the
// no-permission card).
const accountingCapsState = vi.hoisted(() => ({
  current: {
    catalogRead: true,
    connectionsManage: true,
    mappingsManage: true,
    exportsExecute: true,
    remoteMutate: true,
    hasAny: true,
    loaded: true,
  },
}));

vi.mock('./useAccountingCapabilities', () => ({
  useAccountingCapabilities: () => accountingCapsState.current,
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
    getQboAutomatedSalesTaxModeMock.mockResolvedValue({ enabled: false });
    setQboAutomatedSalesTaxModeMock.mockResolvedValue({ success: true });
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

    expect(await screen.findByText(/Intuit did not return the expected tokens/)).toBeInTheDocument();
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

  it('T062: includes guidance that QuickBooks CSV remains available as the manual fallback', async () => {
    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');

    render(<QboIntegrationSettings />);

    expect((await screen.findAllByText('QuickBooks CSV remains available')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Billing → Accounting Exports/)).toBeInTheDocument();
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
  // --- Automated Sales Tax toggle ---

  const connectedStatus = {
    ...disconnectedStatus,
    connected: true,
    defaultRealmId: 'realm-ast-1',
    defaultConnection: {
      realmId: 'realm-ast-1',
      displayName: 'Acme Books',
      status: 'active' as const
    },
    credentials: { ...disconnectedStatus.credentials, ready: true, source: 'app' as const }
  };

  it('T067: the Automated Sales Tax toggle is absent until a company is connected', async () => {
    getQboConnectionStatusMock.mockResolvedValue(disconnectedStatus);

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');
    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByText('https://example.com/api/integrations/qbo/callback')).toBeInTheDocument();
    });

    expect(document.getElementById('qbo-automated-sales-tax-section')).toBeNull();
    expect(getQboAutomatedSalesTaxModeMock).not.toHaveBeenCalled();
  });

  it('T068: a connected company renders the toggle and reads its state for that realm', async () => {
    getQboConnectionStatusMock.mockResolvedValue(connectedStatus);
    getQboAutomatedSalesTaxModeMock.mockResolvedValue({ enabled: true });

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');
    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('qbo-automated-sales-tax-section')).not.toBeNull();
    });

    expect(getQboAutomatedSalesTaxModeMock).toHaveBeenCalledWith({ realmId: 'realm-ast-1' });
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('T068b: the toggle label is rendered once, not doubled by the Switch', async () => {
    // Switch renders its own label beside the thumb when given a `label` prop,
    // which would repeat the Label in the description column.
    getQboConnectionStatusMock.mockResolvedValue(connectedStatus);
    getQboAutomatedSalesTaxModeMock.mockResolvedValue({ enabled: false });

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');
    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('qbo-automated-sales-tax-section')).not.toBeNull();
    });

    const section = document.getElementById('qbo-automated-sales-tax-section') as HTMLElement;
    expect(within(section).getAllByText('QuickBooks calculates sales tax')).toHaveLength(1);
  });

  it('T069: toggling writes the new mode for the connected realm', async () => {
    getQboConnectionStatusMock.mockResolvedValue(connectedStatus);
    getQboAutomatedSalesTaxModeMock.mockResolvedValue({ enabled: false });

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');
    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('qbo-automated-sales-tax-section')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(setQboAutomatedSalesTaxModeMock).toHaveBeenCalledWith({
        realmId: 'realm-ast-1',
        enabled: true
      });
    });
  });

  it('T070: a failed write reverts the toggle and surfaces the error', async () => {
    getQboConnectionStatusMock.mockResolvedValue(connectedStatus);
    getQboAutomatedSalesTaxModeMock.mockResolvedValue({ enabled: false });
    setQboAutomatedSalesTaxModeMock.mockResolvedValue({
      success: false,
      error: 'Automated Sales Tax mode could not be saved.'
    });

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');
    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('qbo-automated-sales-tax-section')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(screen.getByText('Automated Sales Tax mode could not be saved.')).toBeInTheDocument();
    });
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('T070b: a thrown action reverts the toggle and surfaces an error', async () => {
    getQboConnectionStatusMock.mockResolvedValue(connectedStatus);
    getQboAutomatedSalesTaxModeMock.mockResolvedValue({ enabled: false });
    setQboAutomatedSalesTaxModeMock.mockRejectedValue(new Error('network down'));

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');
    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('qbo-automated-sales-tax-section')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('switch'));

    // An optimistic flip left standing would tell the user tax is delegated to
    // Intuit when nothing was saved.
    await waitFor(() => {
      expect(screen.getByText('Failed to update Automated Sales Tax mode.')).toBeInTheDocument();
    });
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  // --- Intuit app provenance ---

  it('T071: an app-level Intuit app is disclosed as a supported path', async () => {
    getQboConnectionStatusMock.mockResolvedValue(connectedStatus);

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');
    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('qbo-credential-source-alert')).not.toBeNull();
    });

    expect(screen.getByText(/shared Intuit app/i)).toBeInTheDocument();
    // Provenance only. The shared app's own credentials are never sent to the
    // browser, so nothing renders a mask of them.
    expect(screen.queryByText(/Stored client id:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stored client secret:/i)).not.toBeInTheDocument();
  });

  it('T072: a tenant-owned Intuit app is named as the active path', async () => {
    getQboConnectionStatusMock.mockResolvedValue({
      ...connectedStatus,
      credentials: { ...connectedStatus.credentials, source: 'tenant' as const }
    });

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');
    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByText(/its own Intuit app/i)).toBeInTheDocument();
    });
  });

  it('T073: with no Intuit app at all, the copy points at registering one', async () => {
    getQboConnectionStatusMock.mockResolvedValue({
      ...disconnectedStatus,
      credentials: { ...disconnectedStatus.credentials, source: null }
    });

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');
    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByText(/No Intuit app is available yet/i)).toBeInTheDocument();
    });
  });

  it('T074: the setup guide is linked from the overview card', async () => {
    getQboConnectionStatusMock.mockResolvedValue(disconnectedStatus);

    const { default: QboIntegrationSettings } = await import('./QboIntegrationSettings');
    render(<QboIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('qbo-setup-guide-link')).not.toBeNull();
    });

    expect(document.getElementById('qbo-setup-guide-link')).toHaveAttribute(
      'href',
      expect.stringContaining('docs/integrations/quickbooks.md')
    );
  });
});
