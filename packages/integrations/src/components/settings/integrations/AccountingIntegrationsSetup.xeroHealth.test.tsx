/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const useSearchParamsMock = vi.hoisted(() => vi.fn());
const useAccountingCapabilitiesMock = vi.hoisted(() => vi.fn());
const healthMock = vi.hoisted(() => vi.fn());
const syncMock = vi.hoisted(() => vi.fn());
const defaultMock = vi.hoisted(() => vi.fn());
const catalogsMock = vi.hoisted(() => vi.fn(async () => []));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createInstance } = await import('i18next');
  const { default: en } = await import('../../../../../../server/public/locales/en/msp/integrations.json');
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  const t = i18n.t.bind(i18n);
  return { useTranslation: () => ({ t }) };
});
vi.mock('@alga-psa/billing/actions/accountingSyncActions', () => ({
  getAccountingSyncHealth: healthMock,
  runAccountingSyncNow: syncMock,
  setDefaultAccountingRealm: defaultMock,
  updateAccountingSyncSettingsAction: vi.fn()
}));
vi.mock('@alga-psa/integrations/actions/qboActions', () => ({
  getQboAccounts: catalogsMock, getQboClasses: catalogsMock, getQboDepartments: catalogsMock
}));

vi.mock('next/navigation', () => ({ useSearchParams: useSearchParamsMock }));
vi.mock('./CSVIntegrationSettings', () => ({ __esModule: true, default: () => null }));
vi.mock('./XeroCsvIntegrationSettings', () => ({ __esModule: true, default: () => null }));
vi.mock('./QboIntegrationSettings', () => ({ __esModule: true, default: () => null }));
vi.mock('./useAccountingCapabilities', () => ({
  useAccountingCapabilities: useAccountingCapabilitiesMock
}));

vi.mock('../../xero/XeroLiveMappingManager', () => ({ XeroLiveMappingManager: () => null }));
vi.mock('../../../actions/integrations/xeroActions', () => ({
  getXeroConnectionStatus: vi.fn(async () => ({
    connected: true,
    connections: [{ connectionId: 'conn-1', xeroTenantId: 'xero-1', status: 'connected' }],
    defaultConnection: { connectionId: 'conn-1', tenantName: 'Xero organisation', status: 'connected' },
    credentials: { ready: true }, scopes: [], scopeOverrideInvalid: []
  })),
  saveXeroCredentials: vi.fn(), disconnectXero: vi.fn(), forceFinalizeXeroDisconnect: vi.fn()
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

describe('AccountingIntegrationsSetup mounts provider-aware health in the Xero flow', () => {
  const originalEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    useSearchParamsMock.mockReturnValue(new URLSearchParams('accounting_integration=xero'));
    useAccountingCapabilitiesMock.mockReturnValue(fullCaps);
  });

  afterEach(() => {
    if (originalEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalEdition;
    }
    cleanup();
    vi.clearAllMocks();
  });

  it('runs the selected Xero organisation even when the global default is QBO, using real English resources', async () => {
    const { default: AccountingIntegrationsSetup } = await import('./AccountingIntegrationsSetup');
    const { default: Panel } = await import('@alga-psa/billing/components/accounting/QboSyncHealthPanel');
    let selected = 'conn-1';
    healthMock.mockImplementation(async (selection) => {
      const isXero = selection?.preferredAdapterType === 'xero';
      return {
        connected: true, adapterType: isXero ? 'xero' : 'quickbooks_online',
        settings: { autoSyncEnabled: true },
        realms: isXero ? ['conn-1', 'conn-2'].map((realmId) => ({ realmId, isDefault: realmId === selected }))
          : [{ realmId: 'qbo-default', isDefault: true }],
        lastCycle: null, pendingOps: 0, erroredOps: 0, driftCount: 0, openExceptions: 0,
        refreshTokenExpiresAt: '2020-01-01T00:00:00Z'
      };
    });
    defaultMock.mockImplementation(async (_provider, realm) => { selected = realm; return { success: true }; });
    syncMock.mockResolvedValue({ ran: true, status: 'succeeded' });

    render(
      <AccountingIntegrationsSetup
        qboSyncHealthSlot={<Panel adapterType="quickbooks_online" />}
        xeroSyncHealthSlot={<Panel adapterType="xero" />}
      />
    );

    expect(await screen.findByText('Xero Sync Health')).toBeInTheDocument();
    expect(screen.getByText('Xero accounting sync status and controls. Runs every 15 minutes.')).toBeInTheDocument();
    expect(screen.getByText('Xero token expired — reconnect to resume syncing.')).toBeInTheDocument();
    expect(catalogsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
    await waitFor(() => expect(defaultMock).toHaveBeenCalledWith('xero', 'conn-2'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync Now' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Sync Now' }));
    await waitFor(() => expect(syncMock).toHaveBeenCalledWith({ preferredAdapterType: 'xero', preferredTargetRealm: 'conn-2' }));
    expect(healthMock.mock.calls.every(([selection]) => selection.preferredAdapterType === 'xero')).toBe(true);
  });
});
