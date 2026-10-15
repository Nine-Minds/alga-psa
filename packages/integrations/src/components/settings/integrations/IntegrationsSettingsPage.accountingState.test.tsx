/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const saveCredentials = vi.hoisted(() => vi.fn());
const getStatus = vi.hoisted(() => vi.fn());
const searchParams = new URLSearchParams('category=accounting&accounting_integration=xero');
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('./useHuduIntegrationEnabled', () => ({ useHuduIntegrationEnabled: () => ({ enabled: false }) }));
vi.mock('../../../lib/calendarAvailability', () => ({
  isCalendarEnterpriseEdition: () => true,
  getVisibleIntegrationCategoryIds: () => ['accounting'],
  resolveIntegrationSettingsCategory: () => 'accounting',
}));
vi.mock('./RmmIntegrationsSetup', () => ({ default: () => null }));
vi.mock('../../email/EmailProviderConfiguration', () => ({ EmailProviderConfiguration: () => null }));
vi.mock('./ProviderCredentialsWorkbench', () => ({ ProviderCredentialsWorkbench: () => null }));
vi.mock('./CalendarEnterpriseIntegrationSettings', () => ({ CalendarEnterpriseIntegrationSettings: () => null }));
vi.mock('./TeamsEnterpriseIntegrationSettings', () => ({ TeamsEnterpriseIntegrationSettings: () => null }));
vi.mock('./telephony/TelephonyEnterpriseIntegrationSettings', () => ({ TelephonyEnterpriseIntegrationSettings: () => null }));
vi.mock('@alga-psa/integrations/entra/components/entry', () => ({ EntraIntegrationSummaryCard: () => null }));
vi.mock('./AccountingIntegrationsSetup', async () => {
  const { default: XeroIntegrationSettings } = await import('./XeroIntegrationSettings');
  return {
    default: ({ xeroSyncHealthSlot }: { xeroSyncHealthSlot?: React.ReactNode }) => (
      <><XeroIntegrationSettings />{xeroSyncHealthSlot}</>
    ),
  };
});
vi.mock('./useAccountingCapabilities', () => ({
  useAccountingCapabilities: () => ({ loaded: true, hasAny: true, catalogRead: true, connectionsManage: true }),
}));
vi.mock('../../xero/XeroLiveMappingManager', () => ({ XeroLiveMappingManager: () => null }));
vi.mock('../../../actions/integrations/xeroActions', () => ({
  getXeroConnectionStatus: getStatus,
  saveXeroCredentials: saveCredentials,
  disconnectXero: vi.fn(),
  forceFinalizeXeroDisconnect: vi.fn(),
}));

import IntegrationsSettingsPage from './IntegrationsSettingsPage';

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('preserves Xero credential drafts and save confirmation when injected panels refresh', async () => {
  const status = {
    connections: [], connected: false,
    redirectUri: 'https://example.com/api/integrations/xero/callback',
    scopes: ['offline_access'], scopeSource: 'default',
    credentials: { ready: false, clientIdConfigured: false, clientSecretConfigured: false },
  };
  getStatus.mockResolvedValue(status);
  let finishSave!: (result: { success: boolean }) => void;
  saveCredentials.mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));

  const { rerender } = render(<IntegrationsSettingsPage xeroSyncHealthSlot={<span>Initial health</span>} />);
  const clientId = await screen.findByLabelText('Client ID');
  const clientSecret = screen.getByLabelText('Client Secret');
  fireEvent.change(clientId, { target: { value: 'browser-xero-client' } });
  fireEvent.change(clientSecret, { target: { value: 'browser-xero-secret' } });

  // A server-action revalidation or parent render supplies fresh slot elements.
  rerender(<IntegrationsSettingsPage xeroSyncHealthSlot={<span>Refreshed health</span>} />);
  expect(screen.getByText('Refreshed health')).toBeInTheDocument();
  expect(await screen.findByLabelText('Client ID')).toHaveValue('browser-xero-client');
  expect(screen.getByLabelText('Client Secret')).toHaveValue('browser-xero-secret');

  fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));
  expect(saveCredentials).toHaveBeenCalledWith({ clientId: 'browser-xero-client', clientSecret: 'browser-xero-secret' });
  getStatus.mockResolvedValue({ ...status, credentials: { ready: true, clientIdConfigured: true, clientSecretConfigured: true } });
  rerender(<IntegrationsSettingsPage xeroSyncHealthSlot={<span>Health after revalidation</span>} />);
  await act(async () => finishSave({ success: true }));
  const confirmation = 'Xero credentials saved. You can now start the live Xero OAuth flow.';
  expect(await screen.findByText(confirmation)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Connect Xero' })).toBeEnabled();

  rerender(<IntegrationsSettingsPage xeroSyncHealthSlot={<span>Latest health</span>} />);
  expect(screen.getByText(confirmation)).toBeInTheDocument();
  expect(screen.getByText('Latest health')).toBeInTheDocument();
});
