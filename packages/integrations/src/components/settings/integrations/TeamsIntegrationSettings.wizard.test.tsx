/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

function microsoftStatus() {
  return {
    success: true,
    baseUrl: 'https://psa.example.com',
    redirectUris: {
      teamsTab: 'https://psa.example.com/api/teams/auth/callback/tab',
      teamsBot: 'https://psa.example.com/api/teams/auth/callback/bot',
      teamsMessageExtension: 'https://psa.example.com/api/teams/auth/callback/message-extension',
    },
    scopes: { teams: ['openid', 'profile', 'offline_access'] },
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
    selectedProfileId: null,
    installStatus: 'not_configured',
    enabledCapabilities: ['personal_tab', 'personal_bot', 'message_extension', 'activity_notifications'],
    notificationCategories: ['assignment', 'customer_reply', 'approval_request', 'escalation', 'sla_risk'],
    notificationChannels: {},
    allowedActions: ['assign_ticket', 'add_note', 'reply_to_contact', 'log_time', 'approval_response'],
    appId: null,
    botId: null,
    packageMetadata: null,
    lastError: null,
    defaultMeetingOrganizerUpn: null,
    defaultMeetingOrganizerObjectId: null,
    sendMeetingInvites: true,
    downloadRecordings: false,
    exposeRecordingsInPortal: false,
    botConnectorConfigured: false,
    addOnState: 'active',
    ...overrides,
  };
}

function teamsStatus(overrides: Record<string, unknown> = {}) {
  return { success: true, integration: integration(overrides) };
}

async function renderSettings() {
  render(<TeamsIntegrationSettings />);
  await waitFor(() => expect(document.querySelector('#teams-setup-wizard')).toBeInTheDocument());
}

describe('TeamsIntegrationSettings guided setup wizard (F053)', () => {
  beforeEach(() => {
    getMicrosoftIntegrationStatusMock.mockResolvedValue(microsoftStatus());
    getTeamsIntegrationStatusMock.mockResolvedValue(teamsStatus());
    getTeamsAppPackageStatusMock.mockResolvedValue({ success: true, package: null });
    saveTeamsIntegrationSettingsMock.mockResolvedValue(teamsStatus());
    runTeamsDiagnosticsMock.mockResolvedValue({ createdAt: '', overallStatus: 'pass', recommendations: [], steps: [] });
    sendTeamsTestMessageMock.mockResolvedValue({ status: 'sent' });
    validateTeamsGraphCredentialsMock.mockResolvedValue({ status: 'ok' });
    probeTeamsGraphPermissionsMock.mockResolvedValue({ status: 'ok', permissions: [{ permission: 'Calendars.ReadWrite', granted: true }] });
    validateTeamsBotConnectorMock.mockResolvedValue({ status: 'ok', appId: 'bot-app' });
    listTeamsDeliveriesMock.mockResolvedValue({ rows: [], nextCursor: null });
    listTeamsAuditEventsMock.mockResolvedValue({ rows: [], nextCursor: null });
    getTeamsAddonPurchaseAccessMock.mockResolvedValue({ canPurchase: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('T089: renders all wizard steps and resumes at the first incomplete step for a fresh tenant', async () => {
    await renderSettings();

    const stepIds = ['microsoft-profile', 'graph-permissions', 'bot-framework', 'activate', 'package', 'sideload', 'verify'];
    for (const id of stepIds) {
      expect(document.querySelector(`#teams-wizard-step-${id}`)).toBeInTheDocument();
    }

    // Fresh tenant (no profile selected): the first step is the resume/current step.
    expect(document.querySelector('#teams-wizard-step-microsoft-profile')).toHaveAttribute('data-current', 'true');
    expect(document.querySelector('#teams-wizard-step-graph-permissions')).toHaveAttribute('data-current', 'false');
    expect(document.querySelector('#teams-wizard-step-verify')).toHaveAttribute('data-current', 'false');
  });

  it('T090: every wizard interactive element carries a kebab-case id (source + native-element assertion)', async () => {
    // Native elements (anchors, list items, paragraphs, step containers) expose the id in the DOM;
    // @alga-psa/ui Button consumes `id` for the UI-reflection registry, so those ids are asserted at source.
    await renderSettings();
    for (const id of ['teams-wizard-step-microsoft-profile', 'teams-wizard-runbook-microsoft-profile', 'teams-wizard-runbook-verify']) {
      expect(document.querySelector(`#${id}`)).toBeInTheDocument();
    }

    const source = fs.readFileSync(
      path.resolve(__dirname, 'TeamsIntegrationSettings.tsx'),
      'utf8',
    );
    for (const id of ['teams-validate-profile', 'teams-probe-permissions', 'teams-validate-bot', 'teams-wizard-activate']) {
      expect(source, `component should declare id="${id}"`).toContain(`id="${id}"`);
    }
  });

  it('T090: activation is blocked until profile validation passes', async () => {
    getTeamsIntegrationStatusMock.mockResolvedValue(teamsStatus({ selectedProfileId: 'profile-1', installStatus: 'install_pending' }));
    const user = userEvent.setup();
    await renderSettings();

    const activateStep = within(document.querySelector('#teams-wizard-step-activate') as HTMLElement);
    expect(activateStep.getByRole('button', { name: /Activate Teams/i })).toBeDisabled();
    expect(document.querySelector('#teams-wizard-activation-blocked')).toBeInTheDocument();

    const profileStep = within(document.querySelector('#teams-wizard-step-microsoft-profile') as HTMLElement);
    await user.click(profileStep.getByRole('button', { name: /Validate Microsoft profile/i }));

    await waitFor(() =>
      expect(
        within(document.querySelector('#teams-wizard-step-activate') as HTMLElement).getByRole('button', { name: /Activate Teams/i }),
      ).not.toBeDisabled(),
    );
    expect(validateTeamsGraphCredentialsMock).toHaveBeenCalled();
    expect(document.querySelector('#teams-wizard-activation-blocked')).not.toBeInTheDocument();
  });

  it('T095/F058: each wizard step links to the correct runbook anchor', async () => {
    await renderSettings();
    const expected: Record<string, string> = {
      'microsoft-profile': '#1-create-the-entra-app-registration',
      'graph-permissions': '#2-grant-graph-application-permissions',
      'bot-framework': '#3-register-the-azure-bot-and-set-bot-credentials',
      activate: '#4-configure-and-activate-teams-in-alga-psa',
      package: '#5-generate-and-upload-the-teams-app-package',
      sideload: '#5-generate-and-upload-the-teams-app-package',
      verify: '#7-verify',
    };
    for (const [step, anchor] of Object.entries(expected)) {
      const link = document.querySelector(`#teams-wizard-runbook-${step}`);
      expect(link, `runbook link for ${step}`).toBeInTheDocument();
      expect(link).toHaveAttribute('href', expect.stringContaining(anchor));
      expect(link).toHaveAttribute('href', expect.stringContaining('teams-setup'));
    }
  });

  it('T090: profile validation failure keeps activation blocked and surfaces the typed message', async () => {
    getTeamsIntegrationStatusMock.mockResolvedValue(teamsStatus({ selectedProfileId: 'profile-1', installStatus: 'install_pending' }));
    validateTeamsGraphCredentialsMock.mockResolvedValue({ status: 'failed', reason: 'invalid_client_secret', message: 'Microsoft rejected the client secret.' });
    const user = userEvent.setup();
    await renderSettings();

    const profileStep = within(document.querySelector('#teams-wizard-step-microsoft-profile') as HTMLElement);
    await user.click(profileStep.getByRole('button', { name: /Validate Microsoft profile/i }));

    expect(await screen.findByText('Microsoft rejected the client secret.')).toBeInTheDocument();
    expect(
      within(document.querySelector('#teams-wizard-step-activate') as HTMLElement).getByRole('button', { name: /Activate Teams/i }),
    ).toBeDisabled();
  });
});
