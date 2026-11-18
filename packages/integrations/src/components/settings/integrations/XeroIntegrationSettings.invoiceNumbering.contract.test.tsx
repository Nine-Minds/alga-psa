/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

const useSearchParamsMock = vi.hoisted(() => vi.fn());
const getXeroConnectionStatusMock = vi.hoisted(() => vi.fn());
const getXeroInvoiceNumberingModeMock = vi.hoisted(() => vi.fn());
const setXeroInvoiceNumberingModeMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock
}));

vi.mock('../../xero/XeroLiveMappingManager', () => ({
  XeroLiveMappingManager: () => <div data-testid="xero-live-mapping-manager" />
}));

vi.mock('../../../actions/integrations/xeroActions', () => ({
  getXeroConnectionStatus: (...args: unknown[]) => getXeroConnectionStatusMock(...args),
  saveXeroCredentials: vi.fn(),
  disconnectXero: vi.fn(),
  forceFinalizeXeroDisconnect: vi.fn(),
  getXeroInvoiceNumberingMode: (...args: unknown[]) => getXeroInvoiceNumberingModeMock(...args),
  setXeroInvoiceNumberingMode: (...args: unknown[]) => setXeroInvoiceNumberingModeMock(...args)
}));

const accountingCapsState = vi.hoisted(() => ({
  current: {
    catalogRead: true,
    connectionsManage: true,
    mappingsManage: true,
    exportsExecute: true,
    remoteMutate: true,
    hasAny: true,
    loaded: true
  }
}));

vi.mock('./useAccountingCapabilities', () => ({
  useAccountingCapabilities: () => accountingCapsState.current
}));

const baseStatus = {
  connections: [],
  connected: false,
  redirectUri: 'https://example.com/api/integrations/xero/callback',
  scopes: ['offline_access'],
  scopeSource: 'default',
  credentials: { clientIdConfigured: true, clientSecretConfigured: true, ready: true }
};

const connectedStatus = {
  ...baseStatus,
  connected: true,
  defaultConnectionId: 'conn-1',
  defaultConnection: {
    connectionId: 'conn-1',
    xeroTenantId: 'xero-org-1',
    tenantName: 'Acme Pty',
    status: 'active'
  },
  connections: [{ connectionId: 'conn-1', xeroTenantId: 'xero-org-1', tenantName: 'Acme Pty', status: 'active' }]
};

async function renderPanel() {
  const { default: XeroIntegrationSettings } = await import('./XeroIntegrationSettings');
  render(<XeroIntegrationSettings />);
}

describe('XeroIntegrationSettings invoice numbering switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountingCapsState.current = {
      catalogRead: true,
      connectionsManage: true,
      mappingsManage: true,
      exportsExecute: true,
      remoteMutate: true,
      hasAny: true,
      loaded: true
    };
    useSearchParamsMock.mockReturnValue(new URLSearchParams('accounting_integration=xero'));
    getXeroInvoiceNumberingModeMock.mockResolvedValue({ enabled: false });
    setXeroInvoiceNumberingModeMock.mockResolvedValue({ success: true, enabled: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders only when there is a default connection', async () => {
    getXeroConnectionStatusMock.mockResolvedValue(baseStatus);
    await renderPanel();
    await screen.findByText('https://example.com/api/integrations/xero/callback');

    expect(document.getElementById('xero-invoice-numbering-section')).toBeNull();
    expect(getXeroInvoiceNumberingModeMock).not.toHaveBeenCalled();
  });

  it('renders the switch with its label once and reads the mode for the default realm', async () => {
    getXeroConnectionStatusMock.mockResolvedValue(connectedStatus);
    getXeroInvoiceNumberingModeMock.mockResolvedValue({ enabled: true });
    await renderPanel();

    await waitFor(() => {
      expect(document.getElementById('xero-invoice-numbering-section')).not.toBeNull();
    });
    expect(getXeroInvoiceNumberingModeMock).toHaveBeenCalledWith({ realmId: 'xero-org-1' });

    const section = document.getElementById('xero-invoice-numbering-section') as HTMLElement;
    expect(within(section).getAllByText('Let Xero assign invoice numbers')).toHaveLength(1);
    const toggle = document.getElementById('xero-assigned-invoice-numbers-toggle') as HTMLElement;
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    // The prefix hint appears once the switch is on.
    expect(within(section).getByText(/Use a prefix that Xero never uses/)).toBeInTheDocument();
  });

  it('hides the prefix hint while the switch is off', async () => {
    getXeroConnectionStatusMock.mockResolvedValue(connectedStatus);
    await renderPanel();
    await waitFor(() => expect(document.getElementById('xero-invoice-numbering-section')).not.toBeNull());
    expect(screen.queryByText(/Use a prefix that Xero never uses/)).toBeNull();
  });

  it('is disabled without connections_manage', async () => {
    accountingCapsState.current = { ...accountingCapsState.current, connectionsManage: false };
    getXeroConnectionStatusMock.mockResolvedValue(connectedStatus);
    await renderPanel();

    await waitFor(() => expect(document.getElementById('xero-assigned-invoice-numbers-toggle')).not.toBeNull());
    await waitFor(() => expect(document.getElementById('xero-assigned-invoice-numbers-toggle')).toBeDisabled());
  });

  it("calls setXeroInvoiceNumberingMode with the default connection's realm", async () => {
    getXeroConnectionStatusMock.mockResolvedValue(connectedStatus);
    await renderPanel();

    await waitFor(() => expect(document.getElementById('xero-assigned-invoice-numbers-toggle')).not.toBeDisabled());
    fireEvent.click(document.getElementById('xero-assigned-invoice-numbers-toggle') as HTMLElement);

    await waitFor(() => {
      expect(setXeroInvoiceNumberingModeMock).toHaveBeenCalledWith({ realmId: 'xero-org-1', enabled: true });
    });
  });

  it('reverts the switch and shows the error when saving fails', async () => {
    getXeroConnectionStatusMock.mockResolvedValue(connectedStatus);
    setXeroInvoiceNumberingModeMock.mockResolvedValue({ success: false, error: 'Nope.' });
    await renderPanel();

    await waitFor(() => expect(document.getElementById('xero-assigned-invoice-numbers-toggle')).not.toBeDisabled());
    fireEvent.click(document.getElementById('xero-assigned-invoice-numbers-toggle') as HTMLElement);

    expect(await screen.findByText('Nope.')).toBeInTheDocument();
    expect(document.getElementById('xero-assigned-invoice-numbers-toggle')).toHaveAttribute('aria-checked', 'false');
  });
});
