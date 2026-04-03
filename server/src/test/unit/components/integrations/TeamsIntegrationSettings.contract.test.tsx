/**
 * @vitest-environment jsdom
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const getMicrosoftIntegrationStatusMock = vi.hoisted(() => vi.fn());
const getTeamsIntegrationStatusMock = vi.hoisted(() => vi.fn());
const getTeamsAppPackageStatusMock = vi.hoisted(() => vi.fn());
const saveTeamsIntegrationSettingsMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/actions', () => ({
  getMicrosoftIntegrationStatus: (...args: unknown[]) => getMicrosoftIntegrationStatusMock(...args),
  getTeamsIntegrationStatus: (...args: unknown[]) => getTeamsIntegrationStatusMock(...args),
  getTeamsAppPackageStatus: (...args: unknown[]) => getTeamsAppPackageStatusMock(...args),
  saveTeamsIntegrationSettings: (...args: unknown[]) => saveTeamsIntegrationSettingsMock(...args),
}));

import { TeamsIntegrationSettings } from '../../../../../../ee/server/src/components/settings/integrations/TeamsIntegrationSettings';

const sharedTeamsSettingsPath = path.resolve(
  __dirname,
  '../../../../../../packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.tsx'
);
const ceStubTeamsSettingsPath = path.resolve(
  __dirname,
  '../../../../../../packages/ee/src/components/settings/integrations/TeamsIntegrationSettings.tsx'
);
const eeTeamsSettingsPath = path.resolve(
  __dirname,
  '../../../../../../ee/server/src/components/settings/integrations/TeamsIntegrationSettings.tsx'
);

function buildMicrosoftStatus(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    baseUrl: 'https://psa.example.com',
    redirectUris: {
      email: 'https://psa.example.com/api/auth/microsoft/callback',
      calendar: 'https://psa.example.com/api/auth/microsoft/calendar/callback',
      sso: 'https://psa.example.com/api/auth/callback/azure-ad',
      teamsTab: 'https://psa.example.com/api/teams/auth/callback/tab',
      teamsBot: 'https://psa.example.com/api/teams/auth/callback/bot',
      teamsMessageExtension: 'https://psa.example.com/api/teams/auth/callback/message-extension',
    },
    scopes: {
      email: ['Mail.Read', 'Mail.Send', 'offline_access'],
      calendar: ['Calendars.ReadWrite', 'offline_access'],
      sso: ['openid', 'profile', 'email'],
      teams: ['openid', 'profile', 'email', 'offline_access'],
    },
    profiles: [
      {
        profileId: 'profile-1',
        displayName: 'Primary Profile',
        clientId: 'primary-client-id',
        tenantId: 'tenant-guid-1',
        clientSecretMasked: '••••1234',
        clientSecretConfigured: true,
        clientSecretRef: 'microsoft_profile_profile-1_client_secret',
        isDefault: true,
        isArchived: false,
        readiness: {
          ready: true,
          clientIdConfigured: true,
          clientSecretConfigured: true,
          tenantIdConfigured: true,
          active: true,
        },
        status: 'ready',
        archivedAt: null,
        consumers: ['Email', 'Calendar', 'MSP SSO'],
      },
      {
        profileId: 'profile-2',
        displayName: 'Secondary Profile',
        clientId: 'secondary-client-id',
        tenantId: 'tenant-guid-2',
        clientSecretMasked: '••••4321',
        clientSecretConfigured: true,
        clientSecretRef: 'microsoft_profile_profile-2_client_secret',
        isDefault: false,
        isArchived: false,
        readiness: {
          ready: true,
          clientIdConfigured: true,
          clientSecretConfigured: true,
          tenantIdConfigured: true,
          active: true,
        },
        status: 'ready',
        archivedAt: null,
        consumers: ['Teams'],
      },
    ],
    ...overrides,
  };
}

function buildTeamsStatus(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    integration: {
      selectedProfileId: 'profile-1',
      installStatus: 'install_pending',
      enabledCapabilities: ['personal_tab', 'message_extension'],
      notificationCategories: ['assignment', 'approval_request'],
      allowedActions: ['assign_ticket', 'log_time'],
      lastError: null,
    },
    ...overrides,
  };
}

function buildTeamsPackageStatus(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    package: {
      installStatus: 'install_pending',
      selectedProfileId: 'profile-1',
      appId: 'primary-client-id',
      botId: 'primary-client-id',
      manifestVersion: '1.24',
      packageVersion: '1.0.0',
      fileName: 'alga-psa-teams-tenant-1.zip',
      baseUrl: 'https://psa.example.com',
      validDomains: ['psa.example.com', 'token.botframework.com'],
      webApplicationInfo: {
        id: 'primary-client-id',
        resource: 'api://psa.example.com/teams/primary-client-id',
      },
      manifest: {
        manifestVersion: '1.24',
      },
    },
    ...overrides,
  };
}

describe('TeamsIntegrationSettings contracts', () => {
  beforeEach(() => {
    getMicrosoftIntegrationStatusMock.mockReset();
    getTeamsIntegrationStatusMock.mockReset();
    getTeamsAppPackageStatusMock.mockReset();
    saveTeamsIntegrationSettingsMock.mockReset();
    getMicrosoftIntegrationStatusMock.mockResolvedValue(buildMicrosoftStatus());
    getTeamsIntegrationStatusMock.mockResolvedValue(buildTeamsStatus());
    getTeamsAppPackageStatusMock.mockResolvedValue(buildTeamsPackageStatus());
    saveTeamsIntegrationSettingsMock.mockResolvedValue({
      success: true,
      integration: buildTeamsStatus().integration,
    });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('zip-data', {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
      },
    }));
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    window.location.hash = '';
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:teams-manifest'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('T084/T189/T190: keeps the concrete Teams settings UI in ee/server while the CE stub stays inert', () => {
    const ceStubSource = fs.readFileSync(ceStubTeamsSettingsPath, 'utf8');

    expect(fs.existsSync(eeTeamsSettingsPath)).toBe(true);
    expect(fs.existsSync(sharedTeamsSettingsPath)).toBe(false);
    expect(ceStubSource).toContain('return null');
  });

  it('T087/T089/T090/T091/T092/T093/T094: preserves the tenant-admin Teams setup concepts, current selections, and refresh path without introducing user-scoped profile selection', async () => {
    const user = userEvent.setup();
    render(<TeamsIntegrationSettings />);

    expect((await screen.findAllByText('Microsoft Teams')).length).toBeGreaterThan(0);
    expect(screen.getByText('Current Teams setup')).toBeInTheDocument();
    expect(screen.getByText('Selected profile:')).toBeInTheDocument();
    expect(screen.getByLabelText('Microsoft profile')).toHaveValue('profile-1');
    expect(screen.getByLabelText('Personal tab')).toBeChecked();
    expect(screen.getByLabelText('Message extension')).toBeChecked();
    expect(screen.getByLabelText('Personal bot')).not.toBeChecked();
    expect(screen.getByLabelText('Assignment events')).toBeChecked();
    expect(screen.getByLabelText('Approval requests')).toBeChecked();
    expect(screen.getByLabelText('Customer replies')).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(getMicrosoftIntegrationStatusMock).toHaveBeenCalledTimes(2);
      expect(getTeamsIntegrationStatusMock).toHaveBeenCalledTimes(2);
    });
  });

  it('T085/T086: reuses the shared Microsoft profile selector and guidance instead of duplicating credential entry', async () => {
    const user = userEvent.setup();
    getTeamsIntegrationStatusMock.mockResolvedValueOnce(buildTeamsStatus({
      integration: {
        selectedProfileId: null,
        installStatus: 'not_configured',
        enabledCapabilities: ['personal_tab'],
        notificationCategories: ['assignment'],
        allowedActions: ['assign_ticket'],
        lastError: null,
      },
    }));

    render(<TeamsIntegrationSettings />);

    expect(await screen.findByText('Install and readiness checklist')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate Teams' })).toBeDisabled();
    expect(screen.getByText('Select a Microsoft profile to view the Teams app-registration values, redirect URIs, and scope guidance for this tenant.')).toBeInTheDocument();
    expect(screen.getByText('Microsoft profile selected')).toBeInTheDocument();
    expect(screen.getByText('Teams install state')).toBeInTheDocument();
    expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Client secret')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tenant ID')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Microsoft profile'), 'profile-1');

    expect(screen.getByRole('button', { name: 'Activate Teams' })).toBeEnabled();
    expect(screen.getAllByText('Primary Profile').length).toBeGreaterThan(0);
    expect(screen.getByText('https://psa.example.com/api/teams/auth/callback/tab')).toBeInTheDocument();
    expect(screen.getByText('https://psa.example.com/api/teams/auth/callback/bot')).toBeInTheDocument();
    expect(screen.getByText('https://psa.example.com/api/teams/auth/callback/message-extension')).toBeInTheDocument();
    expect(screen.getByText('openid, profile, email, offline_access')).toBeInTheDocument();
    expect(screen.getByText('api://psa.example.com/teams/primary-client-id')).toBeInTheDocument();
  });

  it('T099/T100/T103/T104: keeps Teams settings copy aligned with Communication placement and MSP-technician scope', () => {
    const eeSource = fs.readFileSync(eeTeamsSettingsPath, 'utf8');

    expect(eeSource).not.toContain('Providers');
    expect(eeSource).toContain('technicians');
    expect(eeSource).not.toContain('client users');
  });

  it('saves draft Teams setup progress and shows recoverable save failures inline', async () => {
    const user = userEvent.setup();
    getTeamsIntegrationStatusMock.mockResolvedValueOnce(buildTeamsStatus({
      integration: {
        selectedProfileId: null,
        installStatus: 'not_configured',
        enabledCapabilities: ['personal_tab'],
        notificationCategories: ['assignment'],
        allowedActions: ['assign_ticket'],
        lastError: null,
      },
    }));
    saveTeamsIntegrationSettingsMock
      .mockResolvedValueOnce({ success: false, error: 'Selected Microsoft profile is not ready for Teams setup' })
      .mockResolvedValueOnce({
        success: true,
        integration: {
          selectedProfileId: 'profile-1',
          installStatus: 'install_pending',
          enabledCapabilities: ['personal_tab', 'personal_bot'],
          notificationCategories: ['assignment', 'customer_reply'],
          allowedActions: ['assign_ticket', 'add_note'],
          lastError: null,
        },
      });

    render(<TeamsIntegrationSettings />);

    await screen.findByText('Current Teams setup');
    await user.selectOptions(screen.getByLabelText('Microsoft profile'), 'profile-1');
    await user.click(screen.getByLabelText('Personal bot'));
    await user.click(screen.getByLabelText('Customer replies'));
    await user.click(screen.getByLabelText('Add note'));

    await user.click(screen.getByRole('button', { name: 'Save Draft' }));
    expect(await screen.findByText('Selected Microsoft profile is not ready for Teams setup')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => {
      expect(saveTeamsIntegrationSettingsMock).toHaveBeenLastCalledWith({
        selectedProfileId: 'profile-1',
        installStatus: 'install_pending',
        enabledCapabilities: ['personal_tab', 'personal_bot'],
        notificationCategories: ['assignment', 'customer_reply'],
        allowedActions: ['assign_ticket', 'add_note'],
        lastError: null,
      });
    });
  });

  it('T105/T106: activates Teams once required setup is complete and surfaces activation failures safely', async () => {
    const user = userEvent.setup();
    saveTeamsIntegrationSettingsMock
      .mockResolvedValueOnce({ success: false, error: 'A Microsoft profile must be selected before Teams can be activated' })
      .mockResolvedValueOnce({
        success: true,
        integration: {
          selectedProfileId: 'profile-1',
          installStatus: 'active',
          enabledCapabilities: ['personal_tab', 'message_extension'],
          notificationCategories: ['assignment', 'approval_request'],
          allowedActions: ['assign_ticket', 'log_time'],
          lastError: null,
        },
      });

    render(<TeamsIntegrationSettings />);

    await screen.findByText('Current Teams setup');
    await user.selectOptions(screen.getByLabelText('Microsoft profile'), 'profile-1');

    await user.click(screen.getByRole('button', { name: 'Activate Teams' }));
    expect(await screen.findByText('A Microsoft profile must be selected before Teams can be activated')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Activate Teams' }));

    await waitFor(() => {
      expect(saveTeamsIntegrationSettingsMock).toHaveBeenLastCalledWith({
        selectedProfileId: 'profile-1',
        installStatus: 'active',
        enabledCapabilities: ['personal_tab', 'message_extension'],
        notificationCategories: ['assignment', 'approval_request'],
        allowedActions: ['assign_ticket', 'log_time'],
        lastError: null,
      });
    });
  });

  it('T107/T108: deactivates Teams without deleting the selected Microsoft profile', async () => {
    const user = userEvent.setup();
    saveTeamsIntegrationSettingsMock.mockResolvedValueOnce({
      success: true,
      integration: {
        selectedProfileId: 'profile-1',
        installStatus: 'not_configured',
        enabledCapabilities: ['personal_tab', 'message_extension'],
        notificationCategories: ['assignment', 'approval_request'],
        allowedActions: ['assign_ticket', 'log_time'],
        lastError: null,
      },
    });

    render(<TeamsIntegrationSettings />);

    await screen.findByText('Current Teams setup');
    await user.click(screen.getByRole('button', { name: 'Deactivate Teams' }));

    await waitFor(() => {
      expect(saveTeamsIntegrationSettingsMock).toHaveBeenCalledWith({
        selectedProfileId: 'profile-1',
        installStatus: 'not_configured',
        enabledCapabilities: ['personal_tab', 'message_extension'],
        notificationCategories: ['assignment', 'approval_request'],
        allowedActions: ['assign_ticket', 'log_time'],
        lastError: null,
      });
    });
  });

  it('T111/T112/T115/T116: shows guided remediation and links back to Microsoft profile management when no eligible profile exists', async () => {
    const user = userEvent.setup();
    getMicrosoftIntegrationStatusMock.mockResolvedValueOnce(
      buildMicrosoftStatus({
        profiles: [
          {
            profileId: 'profile-2',
            displayName: 'Incomplete Profile',
            clientId: 'incomplete-client-id',
            tenantId: 'tenant-guid-2',
            clientSecretMasked: undefined,
            clientSecretConfigured: false,
            clientSecretRef: 'microsoft_profile_profile-2_client_secret',
            isDefault: false,
            isArchived: false,
            readiness: {
              ready: false,
              clientIdConfigured: true,
              clientSecretConfigured: false,
              tenantIdConfigured: true,
              active: true,
            },
            status: 'incomplete',
            archivedAt: null,
            consumers: [],
          },
        ],
      })
    );

    render(<TeamsIntegrationSettings />);

    expect(await screen.findByText('Create or repair a Microsoft profile before configuring Teams.')).toBeInTheDocument();
    expect(screen.getByText(/Teams setup stays blocked/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open Microsoft Profiles' }));

    expect(window.location.hash).toBe('#microsoft-profile-manager');
  });

  it('T145: prepares and presents the tenant package download/install handoff from Teams setup', async () => {
    const user = userEvent.setup();
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<TeamsIntegrationSettings />);

    await screen.findByText('Teams package handoff');
    await user.click(screen.getByRole('button', { name: 'Prepare package handoff' }));

    await waitFor(() => {
      expect(getTeamsAppPackageStatusMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText('alga-psa-teams-tenant-1.zip')).toBeInTheDocument();
    expect(screen.getAllByText('primary-client-id').length).toBeGreaterThan(0);
    expect(screen.getByText('psa.example.com, token.botframework.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download manifest JSON' }));

    expect((URL.createObjectURL as any)).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect((URL.revokeObjectURL as any)).toHaveBeenCalledWith('blob:teams-manifest');
    anchorClickSpy.mockRestore();
  });

  it('T146: shows a recoverable package handoff error when package generation cannot proceed', async () => {
    const user = userEvent.setup();
    getTeamsAppPackageStatusMock.mockResolvedValueOnce({
      success: false,
      error: 'Selected Microsoft profile is not ready for Teams package generation',
    });

    render(<TeamsIntegrationSettings />);

    await screen.findByText('Teams package handoff');
    await user.click(screen.getByRole('button', { name: 'Prepare package handoff' }));

    expect(await screen.findByText('Selected Microsoft profile is not ready for Teams package generation')).toBeInTheDocument();
  });

  it('shows the backend zip-download error inline instead of relying on the browser download manager', async () => {
    const user = userEvent.setup();
    render(<TeamsIntegrationSettings />);

    await screen.findByRole('button', { name: 'Generate package' });
    await user.click(screen.getByRole('button', { name: 'Generate package' }));

    await waitFor(() => {
      expect(getTeamsAppPackageStatusMock).toHaveBeenCalledTimes(1);
    });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      success: false,
      error: 'Selected Microsoft profile is not ready for Teams package generation',
    }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    await user.click(screen.getByRole('button', { name: 'Download app package (.zip)' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teams/package/download', {
        method: 'GET',
        credentials: 'include',
      });
    });

    expect(await screen.findByText('Selected Microsoft profile is not ready for Teams package generation')).toBeInTheDocument();
  });
});
