// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const actions = vi.hoisted(() => ({
  backfillDattoRmmAlerts: vi.fn(),
  disconnectDattoRmmIntegration: vi.fn(),
  getDattoRmmConnectionSummary: vi.fn(),
  getDattoRmmSettings: vi.fn(),
  getDattoRmmWebhookInfo: vi.fn(),
  ingestDattoRmmSoftwareInventory: vi.fn(),
  listDattoRmmComponents: vi.fn(),
  listDattoRmmSiteMappings: vi.fn(),
  saveDattoRmmConfiguration: vi.fn(),
  syncDattoRmmDevices: vi.fn(),
  syncDattoRmmSites: vi.fn(),
  testDattoRmmConnection: vi.fn(),
  updateDattoRmmSiteMapping: vi.fn(),
}));

vi.mock('@ee/lib/actions/integrations/dattoRmmActions', () => actions);
vi.mock('@alga-psa/integrations/actions', () => ({
  getRmmIntegrationIdByProvider: vi.fn(async () => ({ success: true, data: { integrationId: 'int-1' } })),
}));
vi.mock('@alga-psa/clients/actions', () => ({
  getAllClients: vi.fn(async () => []),
  getAllContacts: vi.fn(async () => []),
}));
vi.mock('@alga-psa/ui/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@alga-psa/ui/context', () => ({ useQuickAddClient: () => ({ renderQuickAddContact: () => null }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string } & Record<string, unknown>) =>
    (options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (m, name) => String(options?.[name] ?? m));
  return { useTranslation: () => ({ t }) };
});
vi.mock('@alga-psa/integrations/components/settings/integrations/RmmAlertAutomationSettings', () => ({ RmmAlertAutomationSettings: () => null }));
vi.mock('@alga-psa/integrations/components/settings/integrations/RmmDeviceSyncSettings', () => ({ RmmDeviceSyncSettings: () => null }));
vi.mock('@alga-psa/integrations/components/settings/integrations/RmmUserContactMappingPanel', () => ({
  buildRmmPeopleModeOptions: () => [],
  RmmUserContactMappingPanel: () => null,
}));
vi.mock('@alga-psa/integrations/components/settings/integrations/RmmOrganizationClientChangeDialog', () => ({ RmmOrganizationClientChangeDialog: () => null }));
vi.mock('@alga-psa/integrations/components/settings/integrations/RmmOrganizationBillingProfileSelect', () => ({ RmmOrganizationBillingProfileSelect: () => null }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => null }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: () => null }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, onConfirm, confirmLabel }: any) =>
    isOpen ? <button type="button" onClick={() => onConfirm()}>{`confirm: ${confirmLabel}`}</button> : null,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, disabled }: any) => (
    <select id={id} value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  ),
}));

import { DattoRmmIntegrationSettings } from '../DattoRmmIntegrationSettings';

const MERLOT_URL = 'https://merlot-api.centrastage.net/api';

function settingsResponse(overrides: { credentials?: boolean; platform?: string; instanceUrl?: string } = {}) {
  const hasCreds = overrides.credentials ?? true;
  return {
    success: true,
    config: {
      platform: overrides.platform ?? 'merlot',
      instanceUrl: overrides.instanceUrl ?? MERLOT_URL,
      isActive: hasCreds,
      resolveAlertsOnTicketClose: false,
      softwareIngestOnSync: false,
      rebootComponentUid: null,
    },
    credentials: { hasApiKey: hasCreds, hasApiSecret: hasCreds, apiKeyMasked: hasCreds ? '••••1234' : undefined },
  };
}

const summary = (isActive: boolean) => ({
  success: true,
  summary: {
    isActive,
    instanceUrl: MERLOT_URL,
    platform: 'merlot',
    counts: { mappedSites: 0, syncedDevices: 0, activeAlerts: 0, byAgentStatus: {} },
  },
});

const saveButton = () => screen.getAllByRole('button', { name: 'Save' })[0];
const resolveSwitch = () => screen.getByRole('switch', { name: /Resolve the Datto alert when its ticket closes/ });
const softwareSwitch = () => screen.getByRole('switch', { name: /Ingest software during device sync/ });

describe('DattoRmmIntegrationSettings', () => {
  beforeEach(() => {
    actions.getDattoRmmSettings.mockResolvedValue(settingsResponse());
    actions.getDattoRmmConnectionSummary.mockResolvedValue(summary(true));
    actions.getDattoRmmWebhookInfo.mockResolvedValue({ success: false });
    actions.listDattoRmmSiteMappings.mockResolvedValue({ success: true, mappings: [] });
    actions.listDattoRmmComponents.mockResolvedValue({ success: true, components: [] });
    actions.saveDattoRmmConfiguration.mockResolvedValue({ success: true });
    actions.disconnectDattoRmmIntegration.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps the success message after a save instead of clearing it when settings reload', async () => {
    const user = userEvent.setup();
    render(<DattoRmmIntegrationSettings />);
    await waitFor(() => expect(screen.queryByText(/Loading Datto RMM settings/)).not.toBeInTheDocument());

    await user.click(saveButton());

    expect(await screen.findByText(/Datto RMM configuration saved/)).toBeInTheDocument();
    // load() ran after the save; the message must still be there.
    await waitFor(() => expect(actions.getDattoRmmSettings.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText(/Datto RMM configuration saved/)).toBeInTheDocument();
  });

  it('keeps the error message from a failed save', async () => {
    actions.saveDattoRmmConfiguration.mockResolvedValue({ success: false, error: 'Nope, not a Datto host' });
    const user = userEvent.setup();
    render(<DattoRmmIntegrationSettings />);
    await waitFor(() => expect(screen.queryByText(/Loading Datto RMM settings/)).not.toBeInTheDocument());

    await user.click(saveButton());
    expect(await screen.findByText('Nope, not a Datto host')).toBeInTheDocument();
  });

  it('enables the option toggles while credentials are stored', async () => {
    render(<DattoRmmIntegrationSettings />);
    await waitFor(() => expect(resolveSwitch()).toBeEnabled());
    expect(softwareSwitch()).toBeEnabled();
    expect(screen.queryByText(/These options are locked/)).not.toBeInTheDocument();
  });

  it('locks the option toggles and reboot-component save after Disconnect, with a hint', async () => {
    const user = userEvent.setup();
    render(<DattoRmmIntegrationSettings />);
    await waitFor(() => expect(resolveSwitch()).toBeEnabled());

    actions.getDattoRmmSettings.mockResolvedValue(settingsResponse({ credentials: false }));
    actions.getDattoRmmConnectionSummary.mockResolvedValue(summary(false));
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await user.click(await screen.findByRole('button', { name: 'confirm: Disconnect' }));

    await waitFor(() => expect(resolveSwitch()).toBeDisabled());
    expect(softwareSwitch()).toBeDisabled();
    expect(screen.getByPlaceholderText('Component UID')).toBeDisabled();
    expect(screen.getAllByText(/These options are locked while no credentials are stored/).length).toBeGreaterThan(0);
    // The disconnect message survives the reload that follows it.
    expect(screen.getByText('Disconnected.')).toBeInTheDocument();
  });

  it('requires the key and secret again before saving a different platform', async () => {
    const user = userEvent.setup();
    render(<DattoRmmIntegrationSettings />);
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await user.selectOptions(document.getElementById('datto-rmm-platform') as HTMLSelectElement, 'concord');
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/Enter the API key and API secret again to save/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('••••1234'), 'NEWKEY');
    expect(saveButton()).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Saved (enter to update)'), 'NEWSECRET');
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText(/Enter the API key and API secret again to save/)).not.toBeInTheDocument();

    // Back to the stored platform: no re-entry needed.
    await user.selectOptions(document.getElementById('datto-rmm-platform') as HTMLSelectElement, 'merlot');
    await user.clear(screen.getByPlaceholderText('••••1234'));
    await user.clear(screen.getByPlaceholderText('Saved (enter to update)'));
    expect(saveButton()).toBeEnabled();
  });
});
