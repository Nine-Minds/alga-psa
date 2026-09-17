// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import IntegrationsSettingsPage from './IntegrationsSettingsPage';

const actions = vi.hoisted(() => ({ status: vi.fn(), save: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('category=accounting&accounting_integration=xero'),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  default: ({ tabs, defaultTab }: { tabs: Array<{ id: string; content: React.ReactNode }>; defaultTab: string }) =>
    tabs.find((tab) => tab.id === defaultTab)?.content,
}));
vi.mock('../../../lib/calendarAvailability', () => ({
  isCalendarEnterpriseEdition: () => true,
  getVisibleIntegrationCategoryIds: () => ['accounting'],
  resolveIntegrationSettingsCategory: () => 'accounting',
}));
vi.mock('./useHuduIntegrationEnabled', () => ({ useHuduIntegrationEnabled: () => ({ enabled: false }) }));
vi.mock('./ProviderCredentialsWorkbench', () => ({ ProviderCredentialsWorkbench: () => null }));
vi.mock('../../email/EmailProviderConfiguration', () => ({ EmailProviderConfiguration: () => null }));
vi.mock('./RmmIntegrationsSetup', () => ({ default: () => null }));
vi.mock('./CalendarEnterpriseIntegrationSettings', () => ({ CalendarEnterpriseIntegrationSettings: () => null }));
vi.mock('./TeamsEnterpriseIntegrationSettings', () => ({ TeamsEnterpriseIntegrationSettings: () => null }));
vi.mock('./telephony/TelephonyEnterpriseIntegrationSettings', () => ({ TelephonyEnterpriseIntegrationSettings: () => null }));
vi.mock('@alga-psa/integrations/entra/components/entry', () => ({ EntraIntegrationSummaryCard: () => null }));
vi.mock('./CSVIntegrationSettings', () => ({ default: () => null }));
vi.mock('./QboIntegrationSettings', () => ({ default: () => null }));
vi.mock('./XeroCsvIntegrationSettings', () => ({ default: () => null }));
vi.mock('../../xero/XeroLiveMappingManager', () => ({ XeroLiveMappingManager: () => null }));
vi.mock('./useAccountingCapabilities', () => ({
  useAccountingCapabilities: () => ({ loaded: true, hasAny: true, catalogRead: true, connectionsManage: true }),
}));
vi.mock('../../../actions/integrations/xeroActions', () => ({
  getXeroConnectionStatus: actions.status,
  saveXeroCredentials: actions.save,
  disconnectXero: vi.fn(),
  forceFinalizeXeroDisconnect: vi.fn(),
}));

const status = (ready: boolean) => ({
  connections: [], connected: false, redirectUri: 'https://example.test/api/integrations/xero/callback',
  scopes: ['offline_access'], scopeSource: 'default',
  credentials: { clientIdConfigured: ready, clientSecretConfigured: ready, ready },
});

// Server action revalidation refreshes the parent's ReactNode slot props.
function settings() {
  return <IntegrationsSettingsPage qboSyncHealthSlot={<div>Sync health</div>} qboOnboardingSlot={<div>Onboarding</div>} />;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
  vi.clearAllMocks();
  actions.status.mockResolvedValue(status(false));
  actions.save.mockResolvedValue({ success: true });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('accounting settings across parent refreshes', () => {
  it('preserves an unsaved Xero credential draft when slot props refresh', async () => {
    const view = render(settings());
    fireEvent.change(await screen.findByLabelText('Xero Client ID'), { target: { value: 'draft-client' } });
    fireEvent.change(screen.getByLabelText('Xero Client Secret'), { target: { value: 'draft-secret' } });
    view.rerender(settings());
    expect(await screen.findByLabelText('Xero Client ID')).toHaveValue('draft-client');
    expect(screen.getByLabelText('Xero Client Secret')).toHaveValue('draft-secret');
    expect(actions.save).not.toHaveBeenCalled();
  });

  it('retains the Xero save confirmation and enables OAuth after revalidation', async () => {
    const view = render(settings());
    fireEvent.change(await screen.findByLabelText('Xero Client ID'), { target: { value: 'browser-xero-client' } });
    fireEvent.change(screen.getByLabelText('Xero Client Secret'), { target: { value: 'browser-xero-secret' } });
    actions.status.mockResolvedValue(status(true));
    fireEvent.click(screen.getByRole('button', { name: 'Save Xero Credentials' }));
    const confirmation = 'Xero credentials saved. You can now start the live Xero OAuth flow.';
    expect(await screen.findByText(confirmation)).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Xero' })).toBeEnabled());
    view.rerender(settings());
    await screen.findByLabelText('Xero Client ID');
    expect(screen.getByText(confirmation)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect Xero' })).toBeEnabled();
    expect(actions.save).toHaveBeenCalledExactlyOnceWith({ clientId: 'browser-xero-client', clientSecret: 'browser-xero-secret' });
  });
});
