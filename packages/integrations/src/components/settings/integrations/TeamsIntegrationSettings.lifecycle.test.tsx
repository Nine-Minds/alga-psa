/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const getMicrosoftIntegrationStatusMock = vi.hoisted(() => vi.fn());
const getTeamsIntegrationStatusMock = vi.hoisted(() => vi.fn());
const getTeamsAppPackageStatusMock = vi.hoisted(() => vi.fn());
const saveTeamsIntegrationSettingsMock = vi.hoisted(() => vi.fn());
const runTeamsDiagnosticsMock = vi.hoisted(() => vi.fn());
const sendTeamsTestMessageMock = vi.hoisted(() => vi.fn());
const validateTeamsGraphCredentialsMock = vi.hoisted(() => vi.fn());
const probeTeamsGraphPermissionsMock = vi.hoisted(() => vi.fn());
const validateTeamsBotConnectorMock = vi.hoisted(() => vi.fn());
const listTeamsDeliveriesMock = vi.hoisted(() => vi.fn());
const listTeamsAuditEventsMock = vi.hoisted(() => vi.fn());
const getTeamsAddonPurchaseAccessMock = vi.hoisted(() => vi.fn());

vi.mock('../../../actions', () => ({
  getMicrosoftIntegrationStatus: (...a: unknown[]) => getMicrosoftIntegrationStatusMock(...a),
  getTeamsIntegrationStatus: (...a: unknown[]) => getTeamsIntegrationStatusMock(...a),
  getTeamsAppPackageStatus: (...a: unknown[]) => getTeamsAppPackageStatusMock(...a),
  saveTeamsIntegrationSettings: (...a: unknown[]) => saveTeamsIntegrationSettingsMock(...a),
  runTeamsDiagnostics: (...a: unknown[]) => runTeamsDiagnosticsMock(...a),
  sendTeamsTestMessage: (...a: unknown[]) => sendTeamsTestMessageMock(...a),
  validateTeamsGraphCredentials: (...a: unknown[]) => validateTeamsGraphCredentialsMock(...a),
  probeTeamsGraphPermissions: (...a: unknown[]) => probeTeamsGraphPermissionsMock(...a),
  validateTeamsBotConnector: (...a: unknown[]) => validateTeamsBotConnectorMock(...a),
  listTeamsDeliveries: (...a: unknown[]) => listTeamsDeliveriesMock(...a),
  listTeamsAuditEvents: (...a: unknown[]) => listTeamsAuditEventsMock(...a),
  getTeamsAddonPurchaseAccess: (...a: unknown[]) => getTeamsAddonPurchaseAccessMock(...a),
}));

import { TeamsIntegrationSettings } from './TeamsIntegrationSettings';

function microsoftStatus(baseUrl = 'https://psa.example.com') {
  return {
    success: true,
    baseUrl,
    redirectUris: { teamsTab: '', teamsBot: '', teamsMessageExtension: '' },
    scopes: { teams: [] },
    profiles: [
      {
        profileId: 'profile-1',
        displayName: 'Primary Profile',
        clientId: 'client-1',
        isArchived: false,
        readiness: { ready: true, clientIdConfigured: true, clientSecretConfigured: true, tenantIdConfigured: true, active: true },
      },
    ],
  };
}

function integration(overrides: Record<string, unknown> = {}) {
  return {
    selectedProfileId: 'profile-1',
    installStatus: 'active',
    enabledCapabilities: ['personal_tab', 'personal_bot', 'message_extension', 'activity_notifications'],
    notificationCategories: ['assignment'],
    notificationChannels: {},
    allowedActions: ['assign_ticket'],
    appId: 'client-1',
    botId: 'client-1',
    packageMetadata: null,
    lastError: null,
    defaultMeetingOrganizerUpn: null,
    defaultMeetingOrganizerObjectId: null,
    sendMeetingInvites: true,
    downloadRecordings: false,
    exposeRecordingsInPortal: false,
    botConnectorConfigured: true,
    addOnState: 'active',
    ...overrides,
  };
}

function freshPackage(baseUrl = 'https://psa.example.com') {
  return {
    installStatus: 'active',
    selectedProfileId: 'profile-1',
    appId: 'client-1',
    botId: 'client-1',
    manifestVersion: '1.24',
    packageVersion: '1.0.0',
    fileName: 'alga-psa-teams-t1.zip',
    baseUrl,
    validDomains: ['psa.example.com'],
    webApplicationInfo: { id: 'client-1', resource: `api://psa.example.com/teams/client-1` },
    deepLinks: {
      myWork: `${baseUrl}/work`,
      ticketTemplate: `${baseUrl}/t`,
      projectTaskTemplate: `${baseUrl}/p`,
      approvalTemplate: `${baseUrl}/a`,
      timeEntryTemplate: `${baseUrl}/e`,
      contactTemplate: `${baseUrl}/c`,
    },
    manifest: { manifestVersion: '1.24' },
  };
}

beforeEach(() => {
  getMicrosoftIntegrationStatusMock.mockResolvedValue(microsoftStatus());
  getTeamsIntegrationStatusMock.mockResolvedValue({ success: true, integration: integration() });
  getTeamsAppPackageStatusMock.mockResolvedValue({ success: true, package: null });
  saveTeamsIntegrationSettingsMock.mockResolvedValue({ success: true, integration: integration() });
  runTeamsDiagnosticsMock.mockResolvedValue({ createdAt: '', overallStatus: 'pass', recommendations: [], steps: [] });
  sendTeamsTestMessageMock.mockResolvedValue({ status: 'sent' });
  validateTeamsGraphCredentialsMock.mockResolvedValue({ status: 'ok' });
  probeTeamsGraphPermissionsMock.mockResolvedValue({ status: 'ok', permissions: [] });
  validateTeamsBotConnectorMock.mockResolvedValue({ status: 'ok', appId: 'bot' });
  listTeamsDeliveriesMock.mockResolvedValue({ rows: [], nextCursor: null });
  listTeamsAuditEventsMock.mockResolvedValue({ rows: [], nextCursor: null });
  getTeamsAddonPurchaseAccessMock.mockResolvedValue({ canPurchase: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TeamsIntegrationSettings add-on lifecycle + stale manifest', () => {
  it('F064: renders only the paywall when the add-on is absent', async () => {
    getTeamsIntegrationStatusMock.mockResolvedValue({ success: false, error: 'Teams add-on required', addOnState: 'absent' });
    render(<TeamsIntegrationSettings />);

    await waitFor(() => expect(document.querySelector('#teams-paywall-card')).toBeInTheDocument());
    // The manage/config surfaces are not rendered.
    expect(screen.queryByText('Diagnostics & Test Message')).not.toBeInTheDocument();
    expect(document.querySelector('#teams-setup-wizard')).not.toBeInTheDocument();
    expect(document.querySelector('#teams-delivery-log-viewer')).not.toBeInTheDocument();
  });

  it('F065: shows the expired banner (and manage view) when the add-on is expired', async () => {
    getTeamsIntegrationStatusMock.mockResolvedValue({ success: true, integration: integration({ addOnState: 'expired' }) });
    render(<TeamsIntegrationSettings />);

    await waitFor(() => expect(document.querySelector('#teams-addon-expired-banner')).toBeInTheDocument());
    // Configuration/history is preserved: the manage view still renders.
    expect(screen.getByText('Diagnostics & Test Message')).toBeInTheDocument();
    // Same renew destination as the paywall.
    expect(screen.getByRole('link', { name: /Renew Teams add-on/i })).toHaveAttribute('href', '/msp/account');
  });

  it('F065: hides the expired banner when the add-on is active', async () => {
    render(<TeamsIntegrationSettings />);
    await waitFor(() => expect(screen.getByText('Diagnostics & Test Message')).toBeInTheDocument());
    expect(document.querySelector('#teams-addon-expired-banner')).not.toBeInTheDocument();
  });

  it('T096: shows the stale-manifest warning when the deployment base URL changed, and regeneration clears it', async () => {
    getTeamsIntegrationStatusMock.mockResolvedValue({
      success: true,
      integration: integration({ packageMetadata: { baseUrl: 'https://old.example.com', webApplicationInfo: { id: 'client-1' } } }),
    });
    getTeamsAppPackageStatusMock.mockResolvedValue({ success: true, package: freshPackage('https://psa.example.com') });

    const user = userEvent.setup();
    render(<TeamsIntegrationSettings />);

    await waitFor(() => expect(document.querySelector('#teams-stale-manifest-warning')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Regenerate package/i }));

    await waitFor(() => expect(document.querySelector('#teams-stale-manifest-warning')).not.toBeInTheDocument());
  });

  it('T096: shows the stale-manifest warning when the selected profile changed since generation', async () => {
    getTeamsIntegrationStatusMock.mockResolvedValue({
      success: true,
      integration: integration({ packageMetadata: { baseUrl: 'https://psa.example.com', webApplicationInfo: { id: 'client-OLD' } } }),
    });
    render(<TeamsIntegrationSettings />);
    await waitFor(() => expect(document.querySelector('#teams-stale-manifest-warning')).toBeInTheDocument());
  });
});
