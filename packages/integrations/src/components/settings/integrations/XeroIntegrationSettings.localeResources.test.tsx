/**
 * @vitest-environment jsdom
 *
 * Renders XeroIntegrationSettings against the real English locale resource
 * (not the component's defaultValue fallbacks), so a stale "first connected
 * organisation" translation would fail the assertion.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

function findLocaleFile(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, 'server/public/locales/en/msp/integrations.json');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new Error('English msp/integrations locale resource not found');
}

const enResource = JSON.parse(fs.readFileSync(findLocaleFile(), 'utf8'));

function resolveKey(resource: unknown, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, resource);
  return typeof value === 'string' ? value : undefined;
}

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      resolveKey(enResource, key) ?? options?.defaultValue ?? key
  })
}));

const useSearchParamsMock = vi.hoisted(() => vi.fn());
const getXeroConnectionStatusMock = vi.hoisted(() => vi.fn());
const saveXeroCredentialsMock = vi.hoisted(() => vi.fn());
const disconnectXeroMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useSearchParams: useSearchParamsMock }));

vi.mock('../../xero/XeroLiveMappingManager', () => ({
  XeroLiveMappingManager: () => <div data-testid="xero-live-mapping-manager" />
}));

vi.mock('../../../actions/integrations/xeroActions', () => ({
  getXeroConnectionStatus: (...args: unknown[]) => getXeroConnectionStatusMock(...args),
  saveXeroCredentials: (...args: unknown[]) => saveXeroCredentialsMock(...args),
  disconnectXero: (...args: unknown[]) => disconnectXeroMock(...args)
}));

vi.mock('./useAccountingCapabilities', () => ({
  useAccountingCapabilities: () => ({
    catalogRead: true,
    connectionsManage: true,
    mappingsManage: true,
    exportsExecute: true,
    remoteMutate: true,
    hasAny: true,
    loaded: true
  })
}));

const settings = enResource.integrations.xero.settings;

describe('XeroIntegrationSettings loaded-locale copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParamsMock.mockReturnValue(new URLSearchParams('accounting_integration=xero'));
    getXeroConnectionStatusMock.mockResolvedValue({
      connections: [],
      connected: true,
      defaultConnectionId: 'conn-1',
      defaultConnection: {
        connectionId: 'conn-1',
        xeroTenantId: 'org-1',
        tenantName: 'Acme Holdings',
        status: 'connected'
      },
      redirectUri: 'https://example.com/api/integrations/xero/callback',
      scopes: ['offline_access'],
      scopeSource: 'default',
      credentials: { clientIdConfigured: true, clientSecretConfigured: true, ready: true }
    });
    saveXeroCredentialsMock.mockResolvedValue({ success: true });
    disconnectXeroMock.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the updated English how-it-works, mapping and reauthorization copy', async () => {
    const { default: XeroIntegrationSettings } = await import('./XeroIntegrationSettings');

    render(<XeroIntegrationSettings />);

    expect(await screen.findByText(settings.howItWorksDescription)).toBeInTheDocument();
    expect(screen.getByText(settings.mapping.alert)).toBeInTheDocument();
    expect(screen.getByText(settings.scopeReconnectNote)).toBeInTheDocument();

    const rendered = document.body.textContent ?? '';
    expect(rendered).not.toContain('first connected Xero organisation');
    expect(rendered).not.toContain('first stored Xero connection');
  });

  it('renders the updated connection-success copy after OAuth', async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams('accounting_integration=xero&xero_status=success')
    );
    const { default: XeroIntegrationSettings } = await import('./XeroIntegrationSettings');

    render(<XeroIntegrationSettings />);

    expect(await screen.findByText(settings.connectSuccess)).toBeInTheDocument();
    expect(settings.connectSuccess).not.toContain('first connected');
  });

  it('surfaces an ambiguous default organisation instead of claiming none is connected', async () => {
    getXeroConnectionStatusMock.mockResolvedValueOnce({
      connections: [],
      connected: false,
      defaultConnectionId: undefined,
      defaultConnection: undefined,
      redirectUri: 'https://example.com/api/integrations/xero/callback',
      scopes: ['offline_access'],
      scopeSource: 'default',
      credentials: { clientIdConfigured: true, clientSecretConfigured: true, ready: true },
      error:
        'The saved default Xero organisation (org-shared) is owned by more than one connection. Choose which connection is the default in the accounting settings before syncing or configuring mappings.',
      errorCode: 'SELECTION_AMBIGUOUS'
    });
    const { default: XeroIntegrationSettings } = await import('./XeroIntegrationSettings');

    render(<XeroIntegrationSettings />);

    expect(await screen.findByText(/owned by more than one connection/)).toBeInTheDocument();
    expect(
      screen.queryByText('No live Xero organisation is connected yet. Save credentials, then click Connect Xero.')
    ).not.toBeInTheDocument();
  });
});
